import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  CONSENT_VERSION,
  type ApproveDemoRequestInput,
  type DemoRejectionReasonValue,
  type DemoRequestListQueryInput,
  type RejectDemoRequestInput,
  type SubmitDemoRequestInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { EMAIL_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import type { EnvVars } from '../../config/env.schema'
import { webBaseUrl } from '../../config/web-base'
import { InviteService } from '../invites/invites.service'

/** Срок жизни ссылки подтверждения адреса. Сутки — как у подтверждения компании. */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Как часто можно переотправить письмо подтверждения на один и тот же адрес.
 *
 * Вторая отправка формы с того же адреса — почти всегда «письмо не пришло», и правильный
 * ответ на неё выслать письмо заново. Но адрес в форме пишет кто угодно, и без паузы
 * этим можно заваливать чужой ящик: пять попыток в четверть часа пропускает throttle
 * контроллера, и все пять превратились бы в письма человеку, который ничего не подавал.
 */
const RESEND_COOLDOWN_MS = 5 * 60 * 1000

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' })

/**
 * Формулировки отказа, которые видит заявитель, и признак «можно прийти снова».
 *
 * Текст живёт здесь, а не в шаблоне письма: шаблон не должен знать про enum'ы, а
 * формулировка — это решение продукта, и менять её будут чаще, чем вёрстку письма.
 */
const REJECTION_TEXT: Record<DemoRejectionReasonValue, { text: string; canReapply: boolean }> = {
  NOT_ELIGIBLE: {
    text: 'Платформа рассчитана на организации высшего и среднего профессионального образования.',
    canReapply: false,
  },
  DUPLICATE: {
    text: 'Заявка от этого вуза у нас уже есть — мы работаем по ней.',
    canReapply: false,
  },
  INSUFFICIENT_INFO: {
    text: 'По заявке не удалось понять, от какой организации она подана.',
    canReapply: true,
  },
  NO_CAPACITY: {
    text: 'Сейчас мы не можем взять новый вуз на тестирование.',
    canReapply: true,
  },
  OTHER: {
    text: 'Сейчас мы не можем открыть доступ по этой заявке.',
    canReapply: true,
  },
}

/**
 * Что видит модератор в очереди. Персональные данные — только те, без которых решение
 * не принять: понять, от кого заявка и с кем говорить.
 */
const REQUEST_SELECT = {
  id: true,
  universityName: true,
  city: true,
  country: true,
  website: true,
  studentsEstimate: true,
  contactName: true,
  contactRole: true,
  email: true,
  phone: true,
  comment: true,
  status: true,
  consentAt: true,
  consentVersion: true,
  reviewedAt: true,
  reviewedById: true,
  rejectionReason: true,
  reviewNote: true,
  universityId: true,
  createdAt: true,
} satisfies Prisma.UniversityDemoRequestSelect

@Injectable()
export class DemoRequestsService {
  private readonly logger = new Logger(DemoRequestsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly invites: InviteService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ── Публичная часть ────────────────────────────────────────────────────────

  /**
   * Подача заявки с публичной формы.
   *
   * Правило «никакой регистрации в обход инвайта» здесь не нарушается и не обходится:
   * заявка не создаёт ни пользователя, ни вуза, ни доступа. Она создаёт строку в
   * очереди к человеку. Доступ появляется только приглашением — тем же, что у всех
   * остальных ролей, и только после решения модератора.
   *
   * Ответ одинаков и для новой заявки, и для повторной: иначе форма превращается в
   * способ узнать, подавал ли этот вуз заявку.
   */
  async submit(input: SubmitDemoRequestInput, ctx: RequestContext): Promise<{ email: string }> {
    const existing = await this.findOpen(input.email)
    if (existing) {
      // Заявка уже в очереди модерации — переотправлять нечего, письмо своё дело сделало.
      if (existing.status === 'NEW') {
        this.logger.warn('Повторная заявка с адреса, по которому заявка уже в очереди')
        return { email: input.email }
      }
      // Адрес не подтверждён, ссылка ещё жива: человек жмёт «отправить» второй раз именно
      // потому, что письма не увидел. Высылаем заново, а не молчим — молчание он читает
      // как «форма сломана» и уходит.
      await this.resendVerification(existing, input.email)
      return { email: input.email }
    }

    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS)

    const request = await this.prisma.universityDemoRequest.create({
      data: {
        universityName: input.universityName,
        city: input.city,
        country: input.country,
        website: input.website,
        studentsEstimate: input.studentsEstimate,
        contactName: input.contactName,
        contactRole: input.contactRole,
        email: input.email,
        phone: input.phone,
        comment: input.comment,
        status: 'PENDING_EMAIL',
        emailVerificationHash: this.hashToken(rawToken),
        emailVerificationExpiresAt: expiresAt,
        // Момент согласия — время сервера, а не клиента: часы браузера ничего не доказывают.
        consentAt: new Date(),
        consentVersion: CONSENT_VERSION,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      select: { id: true, universityName: true },
    })

    await this.queue.enqueue(
      QUEUES.EMAIL,
      EMAIL_JOBS.SEND_DEMO_VERIFICATION,
      {
        to: input.email,
        universityName: request.universityName,
        verifyUrl: `${this.webBase()}/demo/verify?token=${rawToken}`,
        expiresAt: DATE_FORMAT.format(expiresAt),
      },
      { jobId: `demo-verify:${request.id}` },
    )

    await this.audit.record({
      action: 'demo_request_submitted',
      entity: 'UniversityDemoRequest',
      entityId: request.id,
      ...ctx,
    })

    return { email: input.email }
  }

  /**
   * Открытая заявка с этого адреса, если она есть.
   *
   * Открытой считается заявка в очереди (`NEW`) либо неподтверждённая, у которой ЕЩЁ НЕ
   * ИСТЁК срок ссылки. Это и есть причина правки: раньше условие смотрело только на
   * статус, и строка `PENDING_EMAIL` занимала адрес навсегда — ссылка протухала через
   * сутки, а заявка продолжала считаться открытой и молча отбивала все следующие
   * попытки. Человек, до которого не дошло письмо, терял возможность подать заявку с
   * этого адреса, и узнать об этом не мог: ответ всегда один и тот же.
   */
  private async findOpen(email: string) {
    return this.prisma.universityDemoRequest.findFirst({
      where: {
        email,
        OR: [
          { status: 'NEW' },
          { status: 'PENDING_EMAIL', emailVerificationExpiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        universityName: true,
        emailVerificationExpiresAt: true,
      },
    })
  }

  /**
   * Выслать письмо подтверждения заново, обновив токен и срок.
   *
   * Токен именно НОВЫЙ, а не прежний: в базе лежит только его хэш, и достать сырой
   * нельзя. Старая ссылка при этом перестаёт работать — так и надо, действующей ссылка
   * должна быть одна.
   *
   * Пауза между письмами обязательна: адрес в форме пишет кто угодно, и без неё повтор
   * отправки превращается в способ засыпать чужой ящик.
   */
  private async resendVerification(
    existing: { id: string; universityName: string; emailVerificationExpiresAt: Date | null },
    email: string,
  ): Promise<void> {
    const sentAt = existing.emailVerificationExpiresAt
      ? existing.emailVerificationExpiresAt.getTime() - VERIFY_TTL_MS
      : 0
    if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
      this.logger.warn('Повторная заявка: письмо отправляли только что, ждём паузу')
      return
    }

    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS)
    await this.prisma.universityDemoRequest.update({
      where: { id: existing.id },
      data: {
        emailVerificationHash: this.hashToken(rawToken),
        emailVerificationExpiresAt: expiresAt,
      },
    })

    await this.enqueueQuietly(
      EMAIL_JOBS.SEND_DEMO_VERIFICATION,
      {
        to: email,
        universityName: existing.universityName,
        verifyUrl: `${this.webBase()}/demo/verify?token=${rawToken}`,
        expiresAt: DATE_FORMAT.format(expiresAt),
      },
      // jobId со временем: BullMQ отбрасывает дубль по id, и без метки повторное письмо
      // молча не ушло бы — а оно и есть смысл этой ветки.
      `demo-verify:${existing.id}:${expiresAt.getTime()}`,
    )
    this.logger.log('Повторная заявка: письмо подтверждения выслано заново')
  }

  /**
   * Удалить неподтверждённые заявки старше срока. Зовёт крон уборки.
   *
   * Две причины. Первая — адрес: пока строка жива, она мешает подать заявку заново
   * (см. `findOpen`), и протухшие заявки должны исчезать сами. Вторая важнее: в заявке
   * лежат персональные данные, полученные по публичной форме, а форма, которую даже не
   * подтвердили, не повод хранить их бессрочно.
   *
   * Подтверждённые заявки не трогаются никогда: по ним принимали решение, и запись о том,
   * кто и на каком основании получил доступ, переживает саму заявку.
   */
  async purgeUnconfirmed(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.universityDemoRequest.deleteMany({
      where: { status: 'PENDING_EMAIL', createdAt: { lt: olderThan } },
    })
    return count
  }

  /** Подтверждение адреса: заявка попадает в очередь модерации. */
  async verifyEmail(token: string, ctx: RequestContext): Promise<{ status: 'NEW' }> {
    const request = await this.prisma.universityDemoRequest.findFirst({
      where: { emailVerificationHash: this.hashToken(token), status: 'PENDING_EMAIL' },
      select: { id: true, emailVerificationExpiresAt: true },
    })
    if (!request) {
      throw new AppException('NOT_FOUND', 'Ссылка недействительна')
    }
    if (
      request.emailVerificationExpiresAt &&
      request.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new AppException('BAD_REQUEST', 'Срок действия ссылки истёк')
    }

    await this.prisma.universityDemoRequest.update({
      where: { id: request.id },
      data: {
        status: 'NEW',
        // Токен одноразовый: гасим сразу, повторный переход по ссылке ничего не даст.
        emailVerificationHash: null,
        emailVerificationExpiresAt: null,
      },
    })

    await this.audit.record({
      action: 'demo_request_verified',
      entity: 'UniversityDemoRequest',
      entityId: request.id,
      ...ctx,
    })
    return { status: 'NEW' }
  }

  // ── Очередь модерации ──────────────────────────────────────────────────────

  /**
   * Список заявок. Неподтверждённые (PENDING_EMAIL) в общий список не попадают: это
   * ещё не заявки, а брошенные формы, и разбирать их человеку незачем. Увидеть их
   * можно только явным фильтром по статусу.
   */
  async list(query: DemoRequestListQueryInput) {
    const where: Prisma.UniversityDemoRequestWhereInput = query.status
      ? { status: query.status }
      : { status: { not: 'PENDING_EMAIL' } }

    if (query.search) {
      where.OR = [
        { universityName: { contains: query.search, mode: 'insensitive' } },
        { contactName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.universityDemoRequest.findMany({
        where,
        // Новые сверху: очередь разбирают с конца, а не с начала истории.
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: REQUEST_SELECT,
      }),
      this.prisma.universityDemoRequest.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  async getById(id: string) {
    const request = await this.prisma.universityDemoRequest.findUnique({
      where: { id },
      select: REQUEST_SELECT,
    })
    if (!request || request.status === 'PENDING_EMAIL') {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    return request
  }

  /**
   * Одобрение: заводим вуз, выписываем приглашение админу вуза и отправляем одно письмо.
   *
   * Вуз создаётся в статусе PENDING, а не ACTIVE. Одобрена заявка, а не запуск: пока в
   * вузе нет ни факультета, ни группы, показывать его рабочим нечестно — в ACTIVE его
   * переведёт сам админ вуза в конце мастера, когда структура заполнена.
   *
   * Всё, что меняет состояние, идёт одной транзакцией. Письмо — после: сбой почты не
   * должен отменять уже принятое решение, ссылку в этом случае можно выслать повторно.
   */
  async approve(
    actor: JwtPayload,
    id: string,
    input: ApproveDemoRequestInput,
    ctx: RequestContext,
  ) {
    const request = await this.prisma.universityDemoRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        universityName: true,
        city: true,
        country: true,
        contactName: true,
        email: true,
      },
    })
    if (!request) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (request.status !== 'NEW') {
      throw new AppException('CONFLICT', 'Решение по этой заявке уже принято')
    }

    const university = await this.prisma.$transaction(async (tx) => {
      const created = await tx.university.create({
        data: {
          name: input.name ?? request.universityName,
          shortName: input.shortName,
          country: input.country ?? request.country,
          city: input.city ?? request.city,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          status: 'PENDING',
        },
        select: { id: true, name: true },
      })
      // Мастер заводится вместе с вузом: админ вуза входит уже в начатый процесс,
      // а не в пустую платформу, где непонятно, с чего начинать.
      await tx.universityOnboarding.create({ data: { universityId: created.id } })
      return created
    })

    // Приглашение — обычное, по той же цепочке, что и все остальные на платформе
    // (PLATFORM_ADMIN → UNIVERSITY_ADMIN). Своего письма не шлёт: ссылка уйдёт в
    // письме об одобрении, одном на всё событие.
    const invite = await this.invites.create(
      actor,
      { role: Role.UNIVERSITY_ADMIN, email: request.email, universityId: university.id },
      ctx,
      { notify: false },
    )

    const updated = await this.prisma.universityDemoRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedById: actor.sub,
        reviewNote: input.note,
        universityId: university.id,
        inviteId: invite.id,
      },
      select: REQUEST_SELECT,
    })

    await this.enqueueQuietly(
      EMAIL_JOBS.SEND_DEMO_APPROVED,
      {
        to: request.email,
        universityName: university.name,
        contactName: request.contactName,
        inviteUrl: `${this.webBase()}/register?token=${invite.token}`,
        expiresAt: DATE_FORMAT.format(invite.expiresAt),
      },
      `demo-approved:${id}`,
    )

    await this.audit.record({
      userId: actor.sub,
      action: 'demo_request_approved',
      entity: 'UniversityDemoRequest',
      entityId: id,
      metadata: { universityId: university.id },
      ...ctx,
    })

    return updated
  }

  /** Отказ. Письмо уходит всегда: молчание заявитель читает как «письмо потерялось». */
  async reject(actor: JwtPayload, id: string, input: RejectDemoRequestInput, ctx: RequestContext) {
    const request = await this.prisma.universityDemoRequest.findUnique({
      where: { id },
      select: { id: true, status: true, universityName: true, email: true },
    })
    if (!request) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (request.status !== 'NEW') {
      throw new AppException('CONFLICT', 'Решение по этой заявке уже принято')
    }

    const updated = await this.prisma.universityDemoRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: actor.sub,
        rejectionReason: input.reason,
        reviewNote: input.note,
      },
      select: REQUEST_SELECT,
    })

    const { text, canReapply } = REJECTION_TEXT[input.reason]
    await this.enqueueQuietly(
      EMAIL_JOBS.SEND_DEMO_REJECTED,
      {
        to: request.email,
        universityName: request.universityName,
        reasonText: text,
        canReapply,
      },
      `demo-rejected:${id}`,
    )

    await this.audit.record({
      userId: actor.sub,
      action: 'demo_request_rejected',
      entity: 'UniversityDemoRequest',
      entityId: id,
      metadata: { reason: input.reason },
      ...ctx,
    })

    return updated
  }

  // ── Вспомогательное ────────────────────────────────────────────────────────

  /**
   * Постановка письма в очередь после того, как решение уже записано. Сбой Redis не
   * должен ронять ответ и тем более откатывать решение: заявку можно переслать
   * повторно, а вот «одобрено, но ответ 500» модератор прочитает как «не одобрено» и
   * нажмёт ещё раз — на уже заведённом вузе.
   */
  private async enqueueQuietly(
    job: string,
    payload: Record<string, unknown>,
    jobId: string,
  ): Promise<void> {
    try {
      await this.queue.enqueue(QUEUES.EMAIL, job, payload, { jobId })
    } catch (error) {
      this.logger.warn(
        `Не удалось поставить письмо ${job} в очередь (решение уже записано): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private webBase(): string {
    return webBaseUrl(this.config).replace(/\/+$/, '')
  }
}
