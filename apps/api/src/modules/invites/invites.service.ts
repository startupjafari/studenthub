import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { InviteStatus, Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { DEFAULT_LOCALE, TTL } from '@studenthub/shared-config'
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
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { hashInviteToken, inviteTokenLookups } from './invite-token'
import { Paginated } from '../../common/http/paginated'
import { QueueService, QUEUES, EMAIL_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { webBaseUrl } from '../../config/web-base'
import type { RequestContext } from '../auth/auth.service'
import { resolveInviteTarget, type InviteScope } from './invite-hierarchy'
import type { RawBulkRow } from './bulk-parse'
import { emailDict } from '../email/email-strings'

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

// Роли, которые в файле импорта привязываются к группе и к факультету (bulkPreview).
const GROUP_ROLES: Role[] = [Role.STUDENT, Role.STAROSTA]
const FACULTY_ROLES: Role[] = [Role.DEAN, Role.TEACHER]

// Письма массового импорта ставятся в очередь пачками: по одному `await` 500 писем при
// подвисшем Redis ждали бы таймаут постановки 500 раз подряд.
const BULK_EMAIL_CONCURRENCY = 20

/** Группы в scope создателя: имя (lowercased) → id[] и id → факультет группы. */
interface ScopedGroups {
  byName: Map<string, string[]>
  facultyOf: Map<string, string>
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

  /**
   * Создание инвайта: проверка иерархии+scope, одноразовый токен, срок 48ч.
   *
   * `notify: false` отключает письмо-приглашение — для случаев, когда ссылка уходит
   * получателю в составе другого письма. Так устроено одобрение заявки вуза (§31):
   * два письма подряд, «заявка одобрена» и «вас пригласили», читаются как дубль, и
   * человек всё равно нажимает первую попавшуюся ссылку. Сырой токен возвращается
   * вызывающему в любом случае — он и вкладывает его в своё письмо.
   */
  async create(
    issuer: JwtPayload,
    input: CreateInviteInput,
    ctx: RequestContext,
    options: { notify?: boolean } = {},
  ) {
    const invite = await this.insert(this.prisma, issuer, input)
    await this.recordCreated(issuer, invite, ctx)

    // Письмо со ссылкой-приглашением (docs/PROJECT.md §7.3, §10.1) — только если известен
    // адрес получателя. Отправка асинхронна (§9.1): HTTP-ответ её не ждёт.
    if (input.email && options.notify !== false) {
      await this.enqueueInviteEmail(
        input.email,
        invite.token,
        invite.role,
        invite.expiresAt,
        await this.issuerLocale(issuer.sub),
      )
    }

    return invite
  }

  /**
   * Создание инвайта внутри транзакции вызывающего — без аудита и без письма.
   *
   * Для случаев, когда приглашение — часть решения, которое записывается целиком или
   * никак. Одобрение заявки вуза (§31) заводит вуз и приглашение его админу: вуз без
   * приглашения — сирота, в который никто не войдёт, а повторное «Одобрить» после такого
   * сбоя заводило второй вуз. Аудит и письма — побочные эффекты, им место после коммита:
   * вызывающий зовёт `recordCreated`, когда транзакция прошла.
   */
  createInTransaction(tx: Prisma.TransactionClient, issuer: JwtPayload, input: CreateInviteInput) {
    return this.insert(tx, issuer, input)
  }

  /** Запись о выдаче приглашения в аудит. Для инвайта из чужой транзакции — после её коммита. */
  async recordCreated(
    issuer: JwtPayload,
    invite: { id: string; role: string },
    ctx: RequestContext,
  ): Promise<void> {
    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_created',
      entity: 'Invite',
      entityId: invite.id,
      metadata: { role: invite.role },
      ...ctx,
    })
  }

  /**
   * Проверка иерархии и scope, одноразовый токен, срок 48ч, запись в базу через `db` —
   * основной клиент или клиент чужой транзакции.
   */
  private async insert(db: Prisma.TransactionClient, issuer: JwtPayload, input: CreateInviteInput) {
    const scope = resolveInviteTarget(issuer, input)
    await this.assertScopeExists(scope, db)
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + TTL.INVITE_HOURS * 3_600_000)

    const invite = await db.invite.create({
      data: {
        // В базу идёт ХЭШ; сырой токен возвращается вызывающему и уходит в письмо.
        token: hashInviteToken(token),
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

    // Токен возвращается ТОЛЬКО здесь — создателю в момент выдачи (§11.9). Подменяем на
    // сырой: в `invite.token` из базы лежит хэш, по нему зарегистрироваться нельзя.
    return { ...invite, token, expiresAt }
  }

  /**
   * Язык письма-приглашения — язык того, кто приглашает.
   *
   * У адресата учётной записи ещё нет, то есть его языка взять неоткуда, и выбирать
   * приходится между «всегда русский» и «как у приглашающего». Второе ближе к правде:
   * приглашения рассылает сотрудник своего вуза, и вуз, работающий на казахском,
   * рассылает их казахоязычным студентам.
   *
   * Отдельным запросом, а не из токена: язык меняется в настройках, а JWT живёт до
   * истечения — из токена приходил бы язык на момент входа.
   */
  private async issuerLocale(issuerId: string): Promise<string> {
    const issuer = await this.prisma.user.findUnique({
      where: { id: issuerId },
      select: { locale: true },
    })
    return issuer?.locale ?? DEFAULT_LOCALE
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
    locale: string,
  ): Promise<void> {
    // Адрес веба — первый origin CORS_ORIGIN, как у остальных ссылок наружу: вся строка
    // с двумя origin через запятую давала ссылку `https://a,https://b/register?...`.
    const origin = webBaseUrl(this.config).replace(/\/+$/, '')
    const inviteUrl = `${origin}/register?token=${token}`
    const t = emailDict(locale)
    try {
      await this.queue.enqueue(
        QUEUES.EMAIL,
        EMAIL_JOBS.SEND_INVITE,
        {
          to: email,
          locale,
          inviteUrl,
          roleLabel: t.roles[role],
          expiresAt: new Intl.DateTimeFormat(t.dateLocale, {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(expiresAt),
        },
        // jobId — по хэшу: идемпотентность та же (хэш детерминирован), а сырой токен не
        // оседает в Redis именем задачи, которое переживает саму отправку.
        { jobId: `invite:${hashInviteToken(token)}` },
      )
    } catch (err) {
      this.logger.warn(
        `Не удалось поставить письмо-приглашение в очередь (token уже выдан): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  /**
   * Связность scope инвайта: группа лежит на этом факультете, факультет — в этом вузе.
   *
   * resolveInviteTarget берёт вуз и факультет создателя из его токена, а группу и (для
   * преподавателя и декана) факультет — из запроса, и их принадлежность не проверяет. Без
   * этого декан прямым запросом приглашал студента в группу чужого факультета или вуза, а
   * админ вуза — декана на факультет другого вуза: человек получал роль с правами там, где
   * у пригласившего их нет. Несуществующий id даёт тот же отказ, что чужой — не оракул.
   *
   * `db` — клиент транзакции, если инвайт пишется в ней: вуз, заведённый в той же
   * транзакции, снаружи ещё не виден.
   */
  private async assertScopeExists(
    scope: InviteScope,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (scope.groupId) {
      const group = await db.group.findUnique({
        where: { id: scope.groupId },
        select: { facultyId: true, faculty: { select: { universityId: true } } },
      })
      if (
        !group ||
        group.faculty.universityId !== scope.universityId ||
        (scope.facultyId !== null && group.facultyId !== scope.facultyId)
      ) {
        throw new AppException('WRONG_SCOPE', 'Группа вне вашей области')
      }
      return
    }
    if (scope.facultyId) {
      const faculty = await db.faculty.findUnique({
        where: { id: scope.facultyId },
        select: { universityId: true },
      })
      if (!faculty || faculty.universityId !== scope.universityId) {
        throw new AppException('WRONG_SCOPE', 'Факультет вне вашей области')
      }
      return
    }
    if (scope.universityId) {
      const university = await db.university.findUnique({
        where: { id: scope.universityId },
        select: { id: true },
      })
      if (!university) throw new AppException('NOT_FOUND', 'Университет не найден')
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
    const [groups, facultiesByName] = await Promise.all([
      this.loadScopedGroups(issuer),
      this.loadScopedFaculties(issuer),
    ])
    // Адреса — в нижнем регистре, как их сохранит подтверждение (BulkInviteCommitRowSchema).
    const taken = await this.loadTakenEmails(rawRows.map((r) => r.email.trim().toLowerCase()))
    const seenInFile = new Set<string>()

    const rows: BulkInvitePreviewRow[] = rawRows.map((raw) => {
      const email = raw.email.trim().toLowerCase()
      const role = this.parseRole(raw.role)
      const base = {
        line: raw.line,
        email,
        groupName: raw.group,
        facultyName: raw.faculty,
        role: role ?? Role.STUDENT,
      }
      const err = (error: string): BulkInvitePreviewRow => ({
        ...base,
        groupId: null,
        facultyId: null,
        status: 'ERROR',
        error,
      })

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Некорректный email')
      if (role === null) return err(`Неизвестная роль: ${raw.role}`)

      // Группа — у тех, кто в ней учится; факультет — у декана (обязательно) и, по желанию,
      // у преподавателя. Остальным колонкам этих ролей значения не нужны.
      let groupId: string | null = null
      if (GROUP_ROLES.includes(role)) {
        if (!raw.group.trim()) return err('Не указана группа')
        const matches = groups.byName.get(raw.group.trim().toLowerCase())
        if (!matches || matches.length === 0) return err(`Группа не найдена: ${raw.group}`)
        if (matches.length > 1) return err(`Неоднозначное имя группы: ${raw.group}`)
        groupId = matches[0]! // length === 1 гарантировано проверками выше
      }
      let facultyId: string | null = null
      if (FACULTY_ROLES.includes(role)) {
        if (role === Role.DEAN && !raw.faculty.trim()) return err('Не указан факультет')
        if (raw.faculty.trim()) {
          const matches = facultiesByName.get(raw.faculty.trim().toLowerCase())
          if (!matches || matches.length === 0) return err(`Факультет не найден: ${raw.faculty}`)
          if (matches.length > 1) return err(`Неоднозначное имя факультета: ${raw.faculty}`)
          facultyId = matches[0]!
        }
      }

      // Scope/иерархия — единый источник истины resolveInviteTarget (как у одиночного инвайта).
      try {
        resolveInviteTarget(issuer, { role, groupId, facultyId: facultyId ?? issuer.facultyId })
      } catch (e) {
        return err(e instanceof AppException ? e.message : 'Недопустимо для вашей роли')
      }

      if (taken.has(email) || seenInFile.has(email)) {
        return {
          ...base,
          groupId,
          facultyId,
          status: 'DUPLICATE',
          error: 'Уже приглашён или зарегистрирован',
        }
      }
      seenInFile.add(email)
      return { ...base, groupId, facultyId, status: 'READY', error: null }
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
   * (не доверяем клиенту): resolveInviteTarget, принадлежность группы и факультета scope
   * создателя, пропуск дублей. Связность проверяем по уже загруженным группам и факультетам
   * создателя — без запроса на строку: раньше 500 строк давали ~1000 последовательных запросов.
   *
   * Запись — одна транзакция под advisory-локом создателя. Повторная отправка того же файла
   * (вторая вкладка, двойной клик) ждёт первую и, перечитав занятые адреса уже под локом,
   * видит её инвайты — дублей нет. Письма — после коммита, best-effort.
   */
  async bulkCreate(
    issuer: JwtPayload,
    input: BulkInviteCommitInput,
    ctx: RequestContext,
  ): Promise<BulkInviteResult> {
    // id группы и факультета пришли от клиента: перепроверяем, что они в scope создателя.
    // resolveInviteTarget принадлежность не проверяет, и без этого прямым запросом можно
    // было выдать инвайт в группу чужого факультета или вуза.
    const [groups, facultiesByName] = await Promise.all([
      this.loadScopedGroups(issuer),
      this.loadScopedFaculties(issuer),
    ])
    const scopedFaculties = new Set([...facultiesByName.values()].flat())
    const seen = new Set<string>()
    const expiresAt = new Date(Date.now() + TTL.INVITE_HOURS * 3_600_000)

    let skipped = 0
    let failed = 0
    const candidates: { email: string; role: Role; scope: InviteScope }[] = []

    for (const row of input.rows) {
      // Схема уже привела адрес к нижнему регистру; повтор — на случай вызова не из HTTP.
      const email = row.email.trim().toLowerCase()
      if (!email || seen.has(email)) {
        skipped++
        continue
      }
      const role = this.parseRole(row.role ?? '') ?? Role.STUDENT
      const groupId = row.groupId ?? null
      const facultyId = row.facultyId ?? null
      if (
        (groupId !== null && !groups.facultyOf.has(groupId)) ||
        (facultyId !== null && !scopedFaculties.has(facultyId))
      ) {
        failed++
        continue
      }
      let scope: InviteScope
      try {
        scope = resolveInviteTarget(issuer, {
          role,
          groupId,
          facultyId: facultyId ?? issuer.facultyId,
        })
      } catch {
        failed++
        continue
      }
      if (!this.bulkScopeConsistent(scope, groups, scopedFaculties)) {
        failed++
        continue
      }
      seen.add(email)
      candidates.push({ email, role, scope })
    }

    const created =
      candidates.length === 0
        ? []
        : await this.prisma.$transaction(async (tx) => {
            await advisoryXactLock(tx, `invites:bulk:${issuer.sub}`)
            // Занятые адреса — уже под локом: параллельная отправка того же файла к этому
            // моменту закоммитила свои инвайты, и здесь они видны.
            const taken = await this.loadTakenEmails(
              candidates.map((c) => c.email),
              tx,
            )
            const fresh = candidates
              .filter((c) => !taken.has(c.email))
              .map((c) => ({ ...c, token: randomUUID() }))
            if (fresh.length > 0) {
              await tx.invite.createMany({
                data: fresh.map((c) => ({
                  // В базу — хэш, сырой токен уходит только в письмо.
                  token: hashInviteToken(c.token),
                  role: c.role,
                  email: c.email,
                  universityId: c.scope.universityId,
                  facultyId: c.scope.facultyId,
                  groupId: c.scope.groupId,
                  expiresAt,
                  createdById: issuer.sub,
                })),
              })
            }
            return fresh
          })
    skipped += candidates.length - created.length

    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_bulk_created',
      entity: 'Invite',
      metadata: { created: created.length, skipped, failed },
      ...ctx,
    })

    // Письма — best-effort, вне критического пути (сбой Redis не роняет ответ).
    if (created.length > 0) {
      // Один запрос на всю пачку, и только когда есть кому писать: у загрузки без адресов
      // (приглашения выдают ссылками) ходить за языком незачем.
      const locale = await this.issuerLocale(issuer.sub)
      for (let i = 0; i < created.length; i += BULK_EMAIL_CONCURRENCY) {
        await Promise.all(
          created
            .slice(i, i + BULK_EMAIL_CONCURRENCY)
            .map((e) => this.enqueueInviteEmail(e.email, e.token, e.role, expiresAt, locale)),
        )
      }
    }

    return { created: created.length, skipped, failed }
  }

  /**
   * Связность scope строки импорта — то же, что assertScopeExists, но по уже загруженным
   * группам и факультетам создателя, без запроса: группа в его scope и лежит на факультете
   * инвайта; факультет без группы — в его scope. Вуз совпадает по построению: группы и
   * факультеты загружены только из вуза создателя.
   */
  private bulkScopeConsistent(
    scope: InviteScope,
    groups: ScopedGroups,
    faculties: Set<string>,
  ): boolean {
    if (scope.groupId !== null) {
      const facultyOfGroup = groups.facultyOf.get(scope.groupId)
      return (
        facultyOfGroup !== undefined &&
        (scope.facultyId === null || facultyOfGroup === scope.facultyId)
      )
    }
    return scope.facultyId === null || faculties.has(scope.facultyId)
  }

  // Группы в scope создателя: имя(lowercased) → id[] (несколько = неоднозначно) и факультет
  // каждой группы — для проверки связности при подтверждении импорта.
  private async loadScopedGroups(issuer: JwtPayload): Promise<ScopedGroups> {
    const result: ScopedGroups = { byName: new Map(), facultyOf: new Map() }
    if (!issuer.universityId) return result // платформенные без вуза — имена не разрешаем
    const where: Prisma.GroupWhereInput =
      issuer.role === Role.DEAN
        ? { facultyId: issuer.facultyId ?? '__none__' }
        : issuer.role === Role.STAROSTA
          ? { id: issuer.groupId ?? '__none__' }
          : { faculty: { is: { universityId: issuer.universityId } } }
    const groups = await this.prisma.group.findMany({
      where,
      select: { id: true, name: true, facultyId: true },
      take: 2000,
    })
    for (const g of groups) {
      const nameKey = g.name.trim().toLowerCase()
      result.byName.set(nameKey, [...(result.byName.get(nameKey) ?? []), g.id])
      result.facultyOf.set(g.id, g.facultyId)
    }
    return result
  }

  // Факультеты в scope создателя: имя(lowercased) → id[]. Декан — только свой факультет.
  private async loadScopedFaculties(issuer: JwtPayload): Promise<Map<string, string[]>> {
    if (!issuer.universityId) return new Map()
    const where: Prisma.FacultyWhereInput =
      issuer.role === Role.DEAN
        ? { id: issuer.facultyId ?? '__none__' }
        : issuer.role === Role.STAROSTA
          ? { id: '__none__' }
          : { universityId: issuer.universityId }
    const faculties = await this.prisma.faculty.findMany({
      where,
      select: { id: true, name: true },
      take: 500,
    })
    const map = new Map<string, string[]>()
    for (const f of faculties) {
      const nameKey = f.name.trim().toLowerCase()
      map.set(nameKey, [...(map.get(nameKey) ?? []), f.id])
    }
    return map
  }

  /**
   * email'ы, уже занятые пользователем или ожидающим инвайтом — для пометки дублей. Ключи
   * множества — в нижнем регистре.
   *
   * Сначала точное совпадение (индексы по email), затем для ненайденных — без учёта регистра:
   * строки, записанные до нормализации, хранят адрес как пришёл («Ivanov@Uni.kz»), и точный
   * поиск их не видит — получался второй инвайт и вторая учётка того же человека. Запасной
   * поиск — через `in` (точное `LOWER(email) IN (…)`), а не `equals`: тот Prisma строит через
   * ILIKE, где `_` в адресе — шаблон.
   *
   * `db` — клиент транзакции подтверждения импорта: там адреса перечитываются под локом.
   * Запросы по очереди, а не Promise.all: в транзакции они всё равно идут по одному соединению.
   */
  private async loadTakenEmails(
    emails: string[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Set<string>> {
    const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(
      0,
      BULK_INVITE_MAX_ROWS,
    )
    const set = new Set<string>()
    const collect = async (filter: { in: string[]; mode?: Prisma.QueryMode }) => {
      const users = await db.user.findMany({
        where: { email: filter, deletedAt: null },
        select: { email: true },
        take: BULK_INVITE_MAX_ROWS,
      })
      const invites = await db.invite.findMany({
        where: { email: filter, status: InviteStatus.PENDING },
        select: { email: true },
        take: BULK_INVITE_MAX_ROWS,
      })
      for (const u of users) if (u.email) set.add(u.email.toLowerCase())
      for (const i of invites) if (i.email) set.add(i.email.toLowerCase())
    }
    if (list.length === 0) return set
    await collect({ in: list })
    const rest = list.filter((email) => !set.has(email))
    if (rest.length > 0) await collect({ in: rest, mode: 'insensitive' })
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
    const invite = await this.prisma.invite.findFirst({
      where: { token: { in: inviteTokenLookups(token) } },
      select: {
        role: true,
        status: true,
        email: true,
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
    // Ссылка в группу или на факультет, которых уже нет: сказать об этом сразу, а не после
    // заполненной формы регистрации.
    await this.assertScopeAlive(this.prisma, invite)

    return {
      role: invite.role,
      // Приглашение можно выдать без email — ссылкой в мессенджер. Тогда адрес спрашивает
      // форма регистрации (`registerByInvite` принимает его в теле), и она обязана знать,
      // показывать ли поле. Наружу уходит только признак: сам email по публичному токену
      // не отдаём — превью доступно любому, кто держит ссылку.
      emailRequired: !invite.email,
      universityId: invite.universityId,
      facultyId: invite.facultyId,
      groupId: invite.groupId,
      expiresAt: invite.expiresAt,
    }
  }

  /**
   * Отзыв инвайта: создатель, платформенный админ или админ вуза в своём scope. Только PENDING.
   *
   * Запись условная — статус стоит в WHERE: регистрация между проверкой и записью занимала
   * инвайт (USED), а безусловный update переписывал его в REVOKED при живом пользователе.
   */
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

    const { count } = await this.prisma.invite.updateMany({
      where: { id, status: InviteStatus.PENDING },
      data: { status: InviteStatus.REVOKED },
    })
    if (count === 0) {
      throw new AppException('CONFLICT', 'Отозвать можно только ожидающий инвайт')
    }
    await this.audit.record({
      userId: issuer.sub,
      action: 'invite_revoked',
      entity: 'Invite',
      entityId: id,
      ...ctx,
    })
    return { id, status: InviteStatus.REVOKED }
  }

  /**
   * Список инвайтов, созданных пользователем. Offset-пагинация (админская таблица).
   *
   * `scope=university` — все инвайты своего вуза, только админу вуза: отзывать инвайты
   * сотрудников вуза он вправе (revoke), а найти инвайт декана в «своём» списке не мог.
   * Вуз — из токена, не из запроса. `createdBy` — кто выдал: в общем списке это главное.
   */
  async list(issuer: JwtPayload, query: InviteListQueryInput) {
    const { page, limit } = query
    let where: Prisma.InviteWhereInput = { createdById: issuer.sub }
    if (query.scope === 'university') {
      if (issuer.role !== Role.UNIVERSITY_ADMIN || !issuer.universityId) {
        throw new AppException('FORBIDDEN', 'Инвайты всего вуза доступны только админу вуза')
      }
      where = { universityId: issuer.universityId }
    }
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
          createdBy: { select: { id: true, firstName: true, lastName: true } },
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
    const lookups = inviteTokenLookups(token)
    const claim = await tx.invite.updateMany({
      where: { token: { in: lookups }, status: InviteStatus.PENDING, expiresAt: { gt: now } },
      data: { status: InviteStatus.USED, usedAt: now },
    })
    if (claim.count === 0) {
      const existing = await tx.invite.findFirst({
        where: { token: { in: lookups } },
        select: { status: true },
      })
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
    const invite = await tx.invite.findFirstOrThrow({ where: { token: { in: lookups } } })
    // Захват откатится вместе с транзакцией регистрации — ссылка не станет «использованной».
    await this.assertScopeAlive(tx, invite)
    return invite
  }

  /**
   * Отзыв ожидающих приглашений в удаляемый вуз, факультет или группу.
   *
   * Вызывается в транзакции удаления, ДО блокировки самой строки вуза/факультета/группы.
   * У инвайта нет внешних ключей на scope, и без отзыва ссылка жила дальше: человек
   * заполнял форму и получал 400 «Нарушение ссылочной целостности» на вставке
   * пользователя, а инвайт оставался PENDING и считался живым в воронках.
   *
   * Порядок важен. Регистрация захватывает инвайт (блокировка его строки), а потом
   * вставляет пользователя со ссылкой на группу (FOR KEY SHARE строки группы). Если бы
   * удаление сначала держало группу FOR UPDATE, а потом ждало строку инвайта, они
   * заклинили бы друг друга. Отзыв первым шагом: либо регистрация успела занять инвайт —
   * удаление ждёт её и видит студента, либо инвайт уже отозван — регистрация получает
   * INVITE_REVOKED.
   */
  async revokePendingInScope(
    tx: Prisma.TransactionClient,
    scope: { universityId: string } | { facultyId: string } | { groupId: string },
  ): Promise<number> {
    const { count } = await tx.invite.updateMany({
      where: { ...scope, status: InviteStatus.PENDING },
      data: { status: InviteStatus.REVOKED },
    })
    return count
  }

  /**
   * Вуз, факультет и группа инвайта ещё существуют. Нет — для приглашённого это отзыв:
   * зарегистрироваться туда уже нельзя. Ловит ссылки, выданные до того, как удаление
   * стало отзывать инвайты, и инвайт, выписанный параллельно с удалением.
   */
  private async assertScopeAlive(
    db: Prisma.TransactionClient,
    scope: { universityId: string | null; facultyId: string | null; groupId: string | null },
  ): Promise<void> {
    // По очереди, а не Promise.all: в транзакции запросы всё равно идут по одному соединению.
    const alive =
      (!scope.universityId ||
        (await db.university.findUnique({
          where: { id: scope.universityId },
          select: { id: true },
        }))) &&
      (!scope.facultyId ||
        (await db.faculty.findUnique({ where: { id: scope.facultyId }, select: { id: true } }))) &&
      (!scope.groupId ||
        (await db.group.findUnique({ where: { id: scope.groupId }, select: { id: true } })))
    if (!alive) {
      throw new AppException('INVITE_REVOKED', 'Инвайт отозван: группа, факультет или вуз удалены')
    }
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
}
