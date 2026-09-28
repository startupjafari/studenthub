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
 * Сколько заявок с одного адреса держим в очереди. Второй раз с того же адреса —
 * почти всегда «показалось, что не отправилось», а не второй вуз.
 */
const MAX_OPEN_PER_EMAIL = 1

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
    const open = await this.prisma.universityDemoRequest.count({
      where: { email: input.email, status: { in: ['PENDING_EMAIL', 'NEW'] } },
    })
    if (open >= MAX_OPEN_PER_EMAIL) {
      // Молча выходим: письма не будет, а перебор адресов ничего не показывает.
      this.logger.warn('Повторная заявка на тестирование с адреса, по которому уже есть открытая')
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
