import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { TTL } from '@studenthub/shared-config'
import type {
  AcceptCompanyInviteInput,
  CompanyInviteStatus,
  CompanyMemberRole,
  CreateCompanyInviteInput,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PasswordService } from '../../common/security/password.service'
import { AuditService } from '../../common/audit/audit.service'
import { EMAIL_JOBS, QUEUES, QueueService } from '../../common/queue'
import { SessionRevocationService } from '../../common/redis/session-revocation.service'
import { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { webBaseUrl } from '../../config/web-base'
import { PLATFORM_TIME_ZONE } from '../platform/platform.constants'
import { CareerAccessService } from './career-access.service'
import type { RequestContext } from './companies.service'

/** Срок ссылки-приглашения — как у инвайта вуза: двое суток. */
const INVITE_TTL_MS = TTL.INVITE_HOURS * 3_600_000

/**
 * Сколько ожидающих приглашений держит компания одновременно. Каждое — письмо на чужой
 * адрес: без потолка кабинет компании становился бы рассыльщиком.
 */
const PENDING_INVITES_LIMIT = 50

/** Сколько участников и приглашений отдаёт экран команды. Компании — единицы человек. */
const LIST_LIMIT = 100

/** Срок ссылки в письме — в поясе платформы, с подписью пояса (как у подтверждения почты). */
function inviteDeadline(at: Date): string {
  return at.toLocaleString('ru-RU', {
    timeZone: PLATFORM_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/** «a•••@company.kz»: по публичной ссылке адрес целиком не отдаём — её могли переслать. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Команда компании (21.D2): OWNER приглашает коллег по почте и исключает их.
 *
 * Регистрация по приглашению — второй, после саморегистрации работодателя (18.A2), публичный
 * путь создания пользователя вне инвайта вуза, и устроен он по тем же правилам: токен —
 * 256 бит случайности, в базе только SHA-256, одноразовый, со сроком; роль (EMPLOYER),
 * компания и адрес берутся из приглашения, а не из тела запроса. Внутрь вуза такой аккаунт
 * не попадает: студентов он видит только через допуски своей компании.
 */
@Injectable()
export class CompanyMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly access: CareerAccessService,
    private readonly revocation: SessionRevocationService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ── Экран команды (OWNER) ──────────────────────────────────────────────────

  /** Участники и приглашения компании. Приглашения — ожидающие, в том числе истёкшие. */
  async list(viewer: JwtPayload) {
    const companyId = await this.requireOwner(viewer)
    const now = new Date()

    const [members, invites] = await Promise.all([
      this.prisma.companyMember.findMany({
        where: { companyId },
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: LIST_LIMIT,
      }),
      this.prisma.companyInvite.findMany({
        where: { companyId, status: 'PENDING' },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
    ])

    return {
      members: members.map((m) => ({
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        role: m.role as CompanyMemberRole,
        joinedAt: m.createdAt,
        isMe: m.user.id === viewer.sub,
      })),
      invites: invites.map((i) => ({
        ...i,
        role: i.role as CompanyMemberRole,
        expired: i.expiresAt.getTime() <= now.getTime(),
      })),
    }
  }

  /**
   * Пригласить коллегу. Повторное приглашение того же адреса не плодит строк: ожидающее
   * получает новую ссылку и срок, прежняя ссылка гаснет (хэш в записи один).
   *
   * Занят ли адрес аккаунтом платформы, здесь НЕ проверяется и не сообщается: иначе любой
   * работодатель перебирал бы, кто зарегистрирован на платформе. Отказ получит только
   * владелец адреса — открыв ссылку из письма (`COMPANY_INVITE_EMAIL_TAKEN`).
   */
  async invite(viewer: JwtPayload, input: CreateCompanyInviteInput, ctx: RequestContext) {
    const companyId = await this.requireOwner(viewer)
    await this.access.assertCompanyActive(companyId)
    const email = input.email.trim().toLowerCase()

    // Уже в команде этой компании — приглашать незачем. Сверка без учёта регистра: старые
    // адреса могли сохраниться как пришли.
    const member = await this.prisma.companyMember.findFirst({
      where: { companyId, user: { email: { in: [email], mode: 'insensitive' } } },
      select: { id: true },
    })
    if (member) throw new AppException('CONFLICT', 'Этот человек уже в команде компании')

    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

    const invite = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyInvite.findFirst({
        where: { companyId, email, status: 'PENDING' },
        select: { id: true },
      })
      if (existing) {
        return tx.companyInvite.update({
          where: { id: existing.id },
          data: { tokenHash: hashToken(rawToken), expiresAt, invitedById: viewer.sub },
          select: { id: true },
        })
      }
      const pending = await tx.companyInvite.count({
        where: { companyId, status: 'PENDING', expiresAt: { gt: new Date() } },
      })
      if (pending >= PENDING_INVITES_LIMIT) {
        throw new AppException(
          'CONFLICT',
          `Ожидающих приглашений не больше ${PENDING_INVITES_LIMIT} — отзовите ненужные`,
        )
      }
      return tx.companyInvite.create({
        data: {
          companyId,
          email,
          role: 'RECRUITER',
          tokenHash: hashToken(rawToken),
          expiresAt,
          invitedById: viewer.sub,
        },
        select: { id: true },
      })
    })

    const [company, inviter] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } }),
      this.prisma.user.findUnique({
        where: { id: viewer.sub },
        select: { firstName: true, lastName: true },
      }),
    ])

    await this.queue.enqueue(
      QUEUES.EMAIL,
      EMAIL_JOBS.SEND_COMPANY_INVITE,
      {
        to: email,
        companyName: company.name,
        invitedByName: inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : undefined,
        inviteUrl: `${webBaseUrl(this.config)}/employer/join?token=${rawToken}`,
        expiresAt: inviteDeadline(expiresAt),
      },
      // Срок — в jobId: повторное приглашение того же адреса BullMQ иначе отбросил бы как дубль.
      { jobId: `company-invite:${invite.id}:${expiresAt.getTime()}` },
    )

    await this.audit.record({
      userId: viewer.sub,
      action: 'company_invite_created',
      entity: 'CompanyInvite',
      entityId: invite.id,
      metadata: { companyId },
      ...ctx,
    })
    return { id: invite.id, email, expiresAt }
  }

  /** Отозвать ожидающее приглашение: ссылка из письма перестаёт работать сразу. */
  async revokeInvite(viewer: JwtPayload, inviteId: string, ctx: RequestContext): Promise<void> {
    const companyId = await this.requireOwner(viewer)
    const { count } = await this.prisma.companyInvite.updateMany({
      where: { id: inviteId, companyId, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    })
    if (count === 0) {
      // Чужое, несуществующее или уже принятое — для владельца одинаково «нечего отзывать».
      throw new AppException('NOT_FOUND', 'Приглашение не найдено или уже принято')
    }
    await this.audit.record({
      userId: viewer.sub,
      action: 'company_invite_revoked',
      entity: 'CompanyInvite',
      entityId: inviteId,
      metadata: { companyId },
      ...ctx,
    })
  }

  /**
   * Исключить участника. Себя исключить нельзя (иначе компания остаётся без того, кто ею
   * управляет), последнего OWNER — тоже.
   *
   * Членство удаляется, и выданные токены участника гаснут сразу: в access-токене лежит
   * companyId, и без отзыва исключённый ещё до 15 минут работал бы от имени компании.
   * Аккаунт при этом остаётся — без компании он ничего не может (CareerAccessService.
   * requireCompany), а войти снова в эту компанию человек может только по новому
   * приглашению на другой адрес (см. `accept`).
   */
  async removeMember(viewer: JwtPayload, userId: string, ctx: RequestContext): Promise<void> {
    const companyId = await this.requireOwner(viewer)
    if (userId === viewer.sub) {
      throw new AppException('CONFLICT', 'Себя исключить нельзя')
    }

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.companyMember.findFirst({
        where: { companyId, userId },
        select: { id: true, role: true },
      })
      if (!target) throw new AppException('NOT_FOUND', 'Участник не найден')
      if (target.role === 'OWNER') {
        const owners = await tx.companyMember.count({ where: { companyId, role: 'OWNER' } })
        if (owners <= 1) {
          throw new AppException('CONFLICT', 'Нельзя исключить последнего владельца компании')
        }
      }
      await tx.companyMember.delete({ where: { id: target.id } })
    })

    await this.revocation.revokeIssuedBefore(userId)
    this.realtime.disconnectUser(userId)

    await this.audit.record({
      userId: viewer.sub,
      action: 'company_member_removed',
      entity: 'CompanyMember',
      entityId: userId,
      metadata: { companyId },
      ...ctx,
    })
  }

  // ── Публичная сторона: ссылка из письма ────────────────────────────────────

  /**
   * Что показать на странице приёма приглашения до регистрации: компания, срок и адрес —
   * замаскированным, ссылку могли переслать. Состояние приглашения — теми же кодами, что у
   * инвайта вуза (410 INVITE_*), неизвестный токен — 404.
   */
  async preview(token: string) {
    const invite = await this.findByToken(token)
    this.assertUsable(invite)
    return {
      companyName: invite.company.name,
      email: maskEmail(invite.email),
      expiresAt: invite.expiresAt,
    }
  }

  /**
   * Регистрация по приглашению: пользователь EMPLOYER + CompanyMember RECRUITER, одной
   * транзакцией с погашением приглашения. Возвращает id пользователя — сессию выдаёт
   * AuthController, как при регистрации по инвайту.
   *
   * Гашение — условной записью со статусом и сроком в `where`: два параллельных запроса по
   * одной ссылке не создадут двух аккаунтов, второй получит 410 INVITE_USED.
   *
   * Адрес уже занят аккаунтом платформы → 409 COMPANY_INVITE_EMAIL_TAKEN, приглашение
   * остаётся в силе (транзакция откатывается). Касается и работодателя, исключённого из
   * компании: привязать существующий аккаунт по одной ссылке из письма значило бы
   * подтвердить его без пароля. Ответ получает только тот, у кого есть ссылка из письма на
   * этот адрес, поэтому он не превращается в проверку «зарегистрирован ли адрес».
   */
  async accept(input: AcceptCompanyInviteInput, ctx: RequestContext): Promise<{ userId: string }> {
    // Хэш пароля — до транзакции: bcrypt занимает ~250 мс, держать на нём соединение незачем.
    const passwordHash = await this.passwords.hash(input.password)
    const tokenHash = hashToken(input.token)

    const result = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.companyInvite.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          companyId: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          company: { select: { status: true, deletedAt: true } },
        },
      })
      if (!invite) throw new AppException('NOT_FOUND', 'Приглашение не найдено')
      this.assertUsable(invite)
      if (invite.company.deletedAt || invite.company.status !== 'ACTIVE') {
        // Заблокированная или удалённая компания новых людей не принимает.
        throw new AppException('INVITE_REVOKED', 'Компания больше не принимает приглашения')
      }

      // Гашение — раньше проверки адреса. Условная запись берёт блокировку строки
      // приглашения, и параллельный запрос по той же ссылке ждёт здесь коммита первого, а
      // потом получает count 0 → 410. Когда проверка адреса шла первой, второй запрос успевал
      // прочитать приглашение как PENDING и после коммита первого натыкался на только что
      // созданный аккаунт — отвечал 409 «адрес занят» вместо 410 (ловит e2e 21.E4).
      // Отказ ниже по адресу откатывает гашение вместе с транзакцией: ссылка остаётся в силе.
      const acceptedAt = new Date()
      const claimed = await tx.companyInvite.updateMany({
        where: { id: invite.id, status: 'PENDING', expiresAt: { gt: acceptedAt } },
        data: { status: 'ACCEPTED', acceptedAt },
      })
      if (claimed.count === 0) {
        throw new AppException('INVITE_USED', 'Приглашение уже использовано')
      }

      const taken = await tx.user.findFirst({
        where: { email: { in: [invite.email], mode: 'insensitive' } },
        select: { id: true },
      })
      if (taken) {
        throw new AppException(
          'COMPANY_INVITE_EMAIL_TAKEN',
          'На этот адрес уже есть аккаунт StudentHub. Попросите приглашение на другой адрес',
        )
      }

      const user = await tx.user
        .create({
          data: {
            email: invite.email,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            role: Role.EMPLOYER,
            // Работодатель вне вуза: скоуп пустой, как у саморегистрации.
            universityId: null,
            facultyId: null,
            groupId: null,
            profileVisibility: 'PRIVATE',
          },
          select: { id: true },
        })
        .catch((e: unknown) => {
          // Гонка с другой регистрацией на тот же адрес между проверкой и записью.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new AppException(
              'COMPANY_INVITE_EMAIL_TAKEN',
              'На этот адрес уже есть аккаунт StudentHub. Попросите приглашение на другой адрес',
            )
          }
          throw e
        })

      await tx.companyMember.create({
        data: { companyId: invite.companyId, userId: user.id, role: invite.role },
      })
      await tx.companyInvite.update({
        where: { id: invite.id },
        data: { acceptedById: user.id },
      })
      return { userId: user.id, inviteId: invite.id, companyId: invite.companyId }
    })

    await this.audit.record({
      userId: result.userId,
      action: 'company_invite_accepted',
      entity: 'CompanyInvite',
      entityId: result.inviteId,
      metadata: { companyId: result.companyId },
      ...ctx,
    })
    return { userId: result.userId }
  }

  // ── Служебное ──────────────────────────────────────────────────────────────

  private async findByToken(token: string) {
    const invite = await this.prisma.companyInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        company: { select: { name: true } },
      },
    })
    if (!invite) throw new AppException('NOT_FOUND', 'Приглашение не найдено')
    return invite
  }

  /** Состояние приглашения — те же коды 410, что у инвайта вуза: клиент их уже понимает. */
  private assertUsable(invite: { status: string; expiresAt: Date }): void {
    const status = invite.status as CompanyInviteStatus
    if (status === 'ACCEPTED') throw new AppException('INVITE_USED', 'Приглашение уже использовано')
    if (status === 'REVOKED') throw new AppException('INVITE_REVOKED', 'Приглашение отозвано')
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new AppException('INVITE_EXPIRED', 'Срок приглашения истёк')
    }
  }

  /**
   * Компания смотрящего, если он её OWNER. Роль — из базы, а не из токена: в токене её нет,
   * а состав мог измениться после выдачи токена.
   */
  private async requireOwner(viewer: JwtPayload): Promise<string> {
    const companyId = this.access.requireCompany(viewer)
    const member = await this.prisma.companyMember.findUnique({
      where: { userId: viewer.sub },
      select: { companyId: true, role: true },
    })
    if (!member || member.companyId !== companyId) {
      throw new AppException('FORBIDDEN', 'Нет доступа к этой компании')
    }
    if (member.role !== 'OWNER') {
      throw new AppException('FORBIDDEN', 'Командой управляет владелец компании')
    }
    return companyId
  }
}
