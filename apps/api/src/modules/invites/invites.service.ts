import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { InviteStatus, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { TTL } from '@studenthub/shared-config'
import {
  BULK_INVITE_MAX_ROWS,
  type InviteListQueryInput,
  type InviteSortValue,
  type SortOrderValue,
  type BulkInviteCommitInput,
  type BulkInvitePreviewResponse,
  type BulkInvitePreviewRow,
  type BulkInviteResult,
  type CreateInviteInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import { QueueService, QUEUES, EMAIL_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from '../auth/auth.service'
import { resolveInviteTarget } from './invite-hierarchy'
import type { RawBulkRow } from './bulk-parse'

// Человекочитаемые названия ролей для писем (основной язык — русский, полноценный i18n
// писем — Ф13.1; синхронизировано с apps/web/messages/ru.json → "Roles").
const ROLE_LABELS_RU: Record<Role, string> = {
  [Role.PLATFORM_ADMIN]: 'Администратор платформы',
  [Role.PLATFORM_MODERATOR]: 'Модератор платформы',
  [Role.UNIVERSITY_ADMIN]: 'Администратор университета',
  [Role.UNIVERSITY_MODERATOR]: 'Модератор университета',
  [Role.DEAN]: 'Декан',
  [Role.TEACHER]: 'Преподаватель',
  [Role.STAROSTA]: 'Староста',
  [Role.STUDENT]: 'Студент',
}

/**
 * Порядок выборки приглашений по колонке таблицы.
 *
 * Email необязателен (приглашение можно выдать ссылкой), поэтому `nulls: 'last'` —
 * строки без адреса не всплывают наверх при сортировке по возрастанию. Вторым ключом
 * всегда дата создания: без него строки с равным статусом шли бы в произвольном
 * порядке, и постраничная навигация могла показать одну запись дважды.
 */
function inviteOrderBy(
  sort: InviteSortValue | undefined,
  order: SortOrderValue | undefined,
): Prisma.InviteOrderByWithRelationInput[] {
  const dir = order ?? 'asc'
  const byDate: Prisma.InviteOrderByWithRelationInput = { createdAt: 'desc' }
  switch (sort) {
    case 'role':
      return [{ role: dir }, byDate]
    case 'email':
      return [{ email: { sort: dir, nulls: 'last' } }, byDate]
    case 'status':
      return [{ status: dir }, byDate]
    case 'expiresAt':
      return [{ expiresAt: dir }, byDate]
    case 'createdAt':
      return [{ createdAt: dir }]
    default:
      return [byDate]
  }
}

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /** Создание инвайта: проверка иерархии+scope, одноразовый токен, срок 48ч. */
  async create(issuer: JwtPayload, input: CreateInviteInput, ctx: RequestContext) {
    const scope = resolveInviteTarget(issuer, input)
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + TTL.INVITE_HOURS * 3_600_000)

    const invite = await this.prisma.invite.create({
      data: {
        token,
        role: input.role,
        email: input.email,
        universityId: scope.universityId,
        facultyId: scope.facultyId,
        groupId: scope.groupId,
        expiresAt,
        createdById: issuer.sub,
      },
      select: {
        id: true,
        token: true,
        role: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        expiresAt: true,
        status: true,
      },
    })

    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_created',
      entity: 'Invite',
      entityId: invite.id,
      metadata: { role: invite.role },
      ...ctx,
    })

    // Письмо со ссылкой-приглашением (docs/PROJECT.md §7.3, §10.1) — только если известен
    // адрес получателя. Отправка асинхронна (§9.1): HTTP-ответ её не ждёт.
    if (input.email) {
      await this.enqueueInviteEmail(input.email, token, invite.role, expiresAt)
    }

    // Токен возвращается ТОЛЬКО здесь — создателю в момент выдачи (§11.9).
    return invite
  }

  /**
   * Best-effort постановка письма-приглашения в очередь `email`. Инвайт уже сохранён,
   * поэтому сбой Redis не должен ронять HTTP-ответ (docs/RUNBOOK: HTTP не блокируется
   * очередью) — токен всё равно вернётся создателю, ссылку можно передать вручную.
   * jobId = invite:{token} обеспечивает идемпотентность (§9.2): дубль не создаётся.
   */
  private async enqueueInviteEmail(
    email: string,
    token: string,
    role: Role,
    expiresAt: Date,
  ): Promise<void> {
    const origin = this.config.get('CORS_ORIGIN', { infer: true }).replace(/\/+$/, '')
    const inviteUrl = `${origin}/register?token=${token}`
    try {
      await this.queue.enqueue(
        QUEUES.EMAIL,
        EMAIL_JOBS.SEND_INVITE,
        {
          to: email,
          inviteUrl,
          roleLabel: ROLE_LABELS_RU[role],
          expiresAt: new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(expiresAt),
        },
        { jobId: `invite:${token}` },
      )
    } catch (err) {
      this.logger.warn(
        `Не удалось поставить письмо-приглашение в очередь (token уже выдан): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  // ── Массовый импорт (CSV/XLSX) ────────────────────────────────────────────

  /**
   * Предпросмотр массового импорта: парсинг уже сделан в контроллере, здесь — валидация
   * каждой строки БЕЗ записи. Разрешаем имя группы в id (в scope создателя), проверяем роль,
   * scope/иерархию (resolveInviteTarget) и дубли (уже пользователь / уже приглашён / повтор
   * email в файле). Возвращаем статусы для показа перед подтверждением (§7).
   */
  async bulkPreview(issuer: JwtPayload, rawRows: RawBulkRow[]): Promise<BulkInvitePreviewResponse> {
    if (rawRows.length > BULK_INVITE_MAX_ROWS) {
      throw new AppException('BAD_REQUEST', `Не более ${BULK_INVITE_MAX_ROWS} строк за импорт`)
    }
    const groupsByName = await this.loadScopedGroups(issuer)
    const taken = await this.loadTakenEmails(rawRows.map((r) => r.email))
    const seenInFile = new Set<string>()

    const rows: BulkInvitePreviewRow[] = rawRows.map((raw) => {
      const email = raw.email.trim()
      const role = this.parseRole(raw.role)
      const base = { line: raw.line, email, groupName: raw.group, role: role ?? Role.STUDENT }
      const err = (error: string): BulkInvitePreviewRow => ({
        ...base,
        groupId: null,
        status: 'ERROR',
        error,
      })

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Некорректный email')
      if (role === null) return err(`Неизвестная роль: ${raw.role}`)
      if (!raw.group.trim()) return err('Не указана группа')

      const matches = groupsByName.get(raw.group.trim().toLowerCase())
      if (!matches || matches.length === 0) return err(`Группа не найдена: ${raw.group}`)
      if (matches.length > 1) return err(`Неоднозначное имя группы: ${raw.group}`)
      const groupId = matches[0]! // length === 1 гарантировано проверками выше

      // Scope/иерархия — единый источник истины resolveInviteTarget (как у одиночного инвайта).
      try {
        resolveInviteTarget(issuer, { role, groupId, facultyId: issuer.facultyId })
      } catch (e) {
        return err(e instanceof AppException ? e.message : 'Недопустимо для вашей роли')
      }

      const key = email.toLowerCase()
      if (taken.has(key) || seenInFile.has(key)) {
        return { ...base, groupId, status: 'DUPLICATE', error: 'Уже приглашён или зарегистрирован' }
      }
      seenInFile.add(key)
      return { ...base, groupId, status: 'READY', error: null }
    })

    const summary = {
      total: rows.length,
      ready: rows.filter((r) => r.status === 'READY').length,
      duplicate: rows.filter((r) => r.status === 'DUPLICATE').length,
      error: rows.filter((r) => r.status === 'ERROR').length,
    }
    return { rows, summary }
  }

  /**
   * Создание инвайтов по подтверждённым строкам. Каждую строку заново валидируем сервером
   * (не доверяем клиенту): resolveInviteTarget + пропуск дублей. Инвайты создаём одним
   * транзакционным createMany-эквивалентом построчно; письма ставим в очередь best-effort.
   */
  async bulkCreate(
    issuer: JwtPayload,
    input: BulkInviteCommitInput,
    ctx: RequestContext,
  ): Promise<BulkInviteResult> {
    const taken = await this.loadTakenEmails(input.rows.map((r) => r.email))
    const seen = new Set<string>()
    const expiresAt = new Date(Date.now() + TTL.INVITE_HOURS * 3_600_000)

    let created = 0
    let skipped = 0
    let failed = 0
    const emailsToSend: { email: string; token: string; role: Role }[] = []

    for (const row of input.rows) {
      const email = row.email.trim()
      const key = email.toLowerCase()
      if (!email || taken.has(key) || seen.has(key)) {
        skipped++
        continue
      }
      const role = this.parseRole(row.role ?? '') ?? Role.STUDENT
      let scope
      try {
        scope = resolveInviteTarget(issuer, {
          role,
          groupId: row.groupId,
          facultyId: issuer.facultyId,
        })
      } catch {
        failed++
        continue
      }
      const token = randomUUID()
      try {
        await this.prisma.invite.create({
          data: {
            token,
            role,
            email,
            universityId: scope.universityId,
            facultyId: scope.facultyId,
            groupId: scope.groupId,
            expiresAt,
            createdById: issuer.sub,
          },
          select: { id: true },
        })
      } catch {
        failed++
        continue
      }
      seen.add(key)
      created++
      emailsToSend.push({ email, token, role })
    }

    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_bulk_created',
      entity: 'Invite',
      metadata: { created, skipped, failed },
      ...ctx,
    })

    // Письма — best-effort, вне критического пути (сбой Redis не роняет ответ).
    for (const e of emailsToSend) {
      await this.enqueueInviteEmail(e.email, e.token, e.role, expiresAt)
    }

    return { created, skipped, failed }
  }

  // Группы в scope создателя: имя(lowercased) → id[] (несколько = неоднозначно).
  private async loadScopedGroups(issuer: JwtPayload): Promise<Map<string, string[]>> {
    if (!issuer.universityId) return new Map() // платформенные без вуза — имена не разрешаем
    const where: Prisma.GroupWhereInput =
      issuer.role === Role.DEAN
        ? { facultyId: issuer.facultyId ?? '__none__' }
        : issuer.role === Role.STAROSTA
          ? { id: issuer.groupId ?? '__none__' }
          : { faculty: { is: { universityId: issuer.universityId } } }
    const groups = await this.prisma.group.findMany({
      where,
      select: { id: true, name: true },
      take: 2000,
    })
    const map = new Map<string, string[]>()
    for (const g of groups) {
      const nameKey = g.name.trim().toLowerCase()
      map.set(nameKey, [...(map.get(nameKey) ?? []), g.id])
    }
    return map
  }

  // email'ы, уже занятые пользователем или ожидающим инвайтом — для пометки дублей.
  private async loadTakenEmails(emails: string[]): Promise<Set<string>> {
    const list = [...new Set(emails.map((e) => e.trim()).filter(Boolean))].slice(
      0,
      BULK_INVITE_MAX_ROWS,
    )
    if (list.length === 0) return new Set()
    const [users, invites] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { email: { in: list }, deletedAt: null },
        select: { email: true },
        take: BULK_INVITE_MAX_ROWS,
      }),
      this.prisma.invite.findMany({
        where: { email: { in: list }, status: InviteStatus.PENDING },
        select: { email: true },
        take: BULK_INVITE_MAX_ROWS,
      }),
    ])
    const set = new Set<string>()
    for (const u of users) if (u.email) set.add(u.email.toLowerCase())
    for (const i of invites) if (i.email) set.add(i.email.toLowerCase())
    return set
  }

  // Роль из ячейки: пусто → STUDENT; иначе точное имя enum (без учёта регистра) или null.
  private parseRole(raw: string): Role | null {
    if (!raw || !raw.trim()) return Role.STUDENT
    const up = raw.trim().toUpperCase()
    return (Object.values(Role) as string[]).includes(up) ? (up as Role) : null
  }

  /** Публичный preview по токену. Не раскрывает email получателя и создателя (§7). */
  async preview(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { token },
      select: {
        role: true,
        status: true,
        universityId: true,
        facultyId: true,
        groupId: true,
        expiresAt: true,
      },
    })
    if (!invite) {
      throw new AppException('NOT_FOUND', 'Инвайт не найден')
    }
    this.assertUsable(invite.status, invite.expiresAt)

    return {
      role: invite.role,
      universityId: invite.universityId,
      facultyId: invite.facultyId,
      groupId: invite.groupId,
      expiresAt: invite.expiresAt,
    }
  }

  /** Отзыв инвайта: создатель, платформенный админ или админ вуза в своём scope. Только PENDING. */
  async revoke(issuer: JwtPayload, id: string, ctx: RequestContext) {
    const invite = await this.prisma.invite.findUnique({
      where: { id },
      select: { id: true, status: true, createdById: true, universityId: true },
    })
    if (!invite) {
      throw new AppException('NOT_FOUND', 'Инвайт не найден')
    }

    const canRevoke =
      invite.createdById === issuer.sub ||
      issuer.role === Role.PLATFORM_ADMIN ||
      (issuer.role === Role.UNIVERSITY_ADMIN && invite.universityId === issuer.universityId)
    if (!canRevoke) {
      throw new AppException('FORBIDDEN', 'Нет прав на отзыв этого инвайта')
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new AppException('CONFLICT', 'Отозвать можно только ожидающий инвайт')
    }

    await this.prisma.invite.update({ where: { id }, data: { status: InviteStatus.REVOKED } })
    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_revoked',
      entity: 'Invite',
      entityId: id,
      ...ctx,
    })
    return { id, status: InviteStatus.REVOKED }
  }

  /** Список инвайтов, созданных пользователем. Offset-пагинация (админская таблица). */
  async list(issuer: JwtPayload, query: InviteListQueryInput) {
    const { page, limit } = query
    const where = { createdById: issuer.sub }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.invite.findMany({
        where,
        orderBy: inviteOrderBy(query.sort, query.order),
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          role: true,
          email: true,
          status: true,
          universityId: true,
          facultyId: true,
          groupId: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.invite.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  /**
   * Атомарно «занимает» инвайт в транзакции регистрации (защита от двойного клика):
   * помечает USED только если он PENDING и не просрочен. Иначе — точный код ошибки.
   * Вызывается из AuthService.registerByInvite внутри его $transaction.
   */
  async claimInvite(tx: Prisma.TransactionClient, token: string) {
    const now = new Date()
    const claim = await tx.invite.updateMany({
      where: { token, status: InviteStatus.PENDING, expiresAt: { gt: now } },
      data: { status: InviteStatus.USED, usedAt: now },
    })
    if (claim.count === 0) {
      const existing = await tx.invite.findUnique({ where: { token }, select: { status: true } })
      if (!existing) {
        throw new AppException('NOT_FOUND', 'Инвайт не найден')
      }
      if (existing.status === InviteStatus.USED) {
        throw new AppException('INVITE_USED', 'Инвайт уже использован')
      }
      if (existing.status === InviteStatus.REVOKED) {
        throw new AppException('INVITE_REVOKED', 'Инвайт отозван')
      }
      throw new AppException('INVITE_EXPIRED', 'Срок инвайта истёк')
    }
    return tx.invite.findUniqueOrThrow({ where: { token } })
  }

  /** Привязывает созданного пользователя к использованному инвайту (аудит). */
  markUsed(tx: Prisma.TransactionClient, inviteId: string, userId: string) {
    return tx.invite.update({ where: { id: inviteId }, data: { usedById: userId } })
  }

  private assertUsable(status: InviteStatus, expiresAt: Date): void {
    if (status === InviteStatus.USED) {
      throw new AppException('INVITE_USED', 'Инвайт уже использован')
    }
    if (status === InviteStatus.REVOKED) {
      throw new AppException('INVITE_REVOKED', 'Инвайт отозван')
    }
    if (status === InviteStatus.EXPIRED || expiresAt.getTime() < Date.now()) {
      throw new AppException('INVITE_EXPIRED', 'Срок инвайта истёк')
    }
  }
  /**
   * Невостребованные инвайты старше `olderThan` — строка суточной сводки
   * (docs/TELEGRAM_BOT.md §2.3). Растущее число значит, что людей позвали, а они не дошли:
   * письма не доходят, ссылку не передали, роль выдали не тому.
   *
   * Только счётчик: ни адресатов, ни токенов наружу (§0.1.1).
   */
  async staleCount(olderThan: Date): Promise<number> {
    return this.prisma.invite.count({
      where: { status: InviteStatus.PENDING, createdAt: { lt: olderThan } },
    })
  }
}
