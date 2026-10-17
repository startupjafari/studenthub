import { Injectable, Logger } from '@nestjs/common'
import { PostAudience, Prisma } from '@prisma/client'
import { Role, isHigherRole } from '@studenthub/shared-types'
import {
  meetingProviderOf,
  type CreateEventCommentInput,
  type CreateEventInput,
  type EventListQueryInput,
  type EventMeeting,
  type UpdateEventInput,
} from '@studenthub/shared-schemas'
import { eventVisibilityWhere } from './event-visibility'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'

// Аудитории событий по роли (docs/PROJECT.md §2.2: студент — ограниченно, только своя группа).
const ALLOWED_AUDIENCES: Record<Role, PostAudience[]> = {
  [Role.PLATFORM_ADMIN]: [PostAudience.ALL],
  [Role.PLATFORM_MODERATOR]: [],
  [Role.UNIVERSITY_ADMIN]: [
    PostAudience.UNIVERSITY,
    PostAudience.FACULTY,
    PostAudience.GROUP,
    PostAudience.TEACHERS,
  ],
  [Role.UNIVERSITY_MODERATOR]: [],
  [Role.DEAN]: [PostAudience.FACULTY, PostAudience.GROUP],
  [Role.TEACHER]: [PostAudience.GROUP, PostAudience.SUBJECT],
  [Role.STAROSTA]: [PostAudience.GROUP],
  // Работодатель (Ф18) событий платформы не создаёт: карьерные мероприятия организует
  // вуз, а компания в них участвует.
  [Role.EMPLOYER]: [],
  [Role.STUDENT]: [PostAudience.GROUP],
}

// Окно напоминаний за час (docs/BACKEND_RULES.md §9.3): [now+55м, now+70м].
const REMINDER_WINDOW_MIN = { from: 55, to: 70 }
const BATCH = 500
// Участников у события может быть сколько угодно (событие вуза — это весь вуз), а напоминание
// обязано дойти до каждого. Поэтому читаем участников страницами и на каждую ставим свой job:
// обрезать список потолком нельзя, тянуть целиком одним findMany — нельзя (BACKEND_RULES §7.2).
const PARTICIPANTS_BATCH = 500

// Окно подключения к встрече (Ф14.5). За пятнадцать минут — чтобы успеть проверить звук
// и зайти до начала; после конца ещё полчаса — встречи регулярно задерживаются, и кнопка,
// погасшая ровно в endsAt, выгоняет тех, кто ещё обсуждает.
const JOIN_BEFORE_MIN = 15
const JOIN_AFTER_MIN = 30
// Сколько длится событие без указанного конца: иначе окно подключения не закрылось бы никогда.
const DEFAULT_DURATION_MIN = 120

const ORGANIZER_SELECT = { select: { id: true, firstName: true, lastName: true } }

const EVENT_SELECT = {
  id: true,
  audience: true,
  title: true,
  description: true,
  location: true,
  isOnline: true,
  // Провайдер в списках есть, ССЫЛКИ НЕТ: она уходит только участникам и только
  // отдельным запросом (`GET /events/:id/meeting`). Иначе ссылка на встречу
  // разлеталась бы вместе с карточкой события по всей его аудитории.
  meetingProvider: true,
  startsAt: true,
  endsAt: true,
  organizerId: true,
  universityId: true,
  facultyId: true,
  groupId: true,
  createdAt: true,
  organizer: ORGANIZER_SELECT,
  _count: { select: { participants: true } },
} satisfies Prisma.EventSelect

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>

// Потолок обсуждения под событием в одном ответе (BACKEND_RULES §5.3: findMany без take нельзя).
const COMMENTS_LIMIT = 100

const COMMENT_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  author: { select: { id: true, firstName: true, lastName: true, avatarThumbUrl: true } },
} satisfies Prisma.EventCommentSelect

interface EventTarget {
  universityId?: string
  facultyId?: string
  groupId?: string
}

function isPlatform(role: Role): boolean {
  return role === Role.PLATFORM_ADMIN || role === Role.PLATFORM_MODERATOR
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  // ── Видимость (по аналогии с постами, задача 10.2) ─────────────────────────

  async list(viewer: JwtPayload, query: EventListQueryInput): Promise<Paginated<unknown>> {
    const now = new Date()
    const timeWhere: Prisma.EventWhereInput =
      query.filter === 'past' ? { startsAt: { lt: now } } : { startsAt: { gte: now } }
    const where: Prisma.EventWhereInput = {
      AND: [
        eventVisibilityWhere(viewer),
        timeWhere,
        ...(query.mine ? [{ participants: { some: { userId: viewer.sub } } }] : []),
      ],
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        select: {
          ...EVENT_SELECT,
          participants: { where: { userId: viewer.sub }, select: { id: true } },
        },
        orderBy: { startsAt: query.filter === 'past' ? 'desc' : 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.event.count({ where }),
    ])
    const items = rows.map(({ participants, ...e }) => ({
      ...e,
      isRegistered: participants.length > 0,
    }))
    return new Paginated(items, { total })
  }

  async getById(viewer: JwtPayload, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, ...eventVisibilityWhere(viewer) },
      select: {
        ...EVENT_SELECT,
        participants: { where: { userId: viewer.sub }, select: { id: true } },
      },
    })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
    const { participants, ...rest } = event
    return { ...rest, isRegistered: participants.length > 0 }
  }

  /**
   * Ссылка на онлайн-встречу (Ф14.5).
   *
   * Отдельная ручка, а не поле карточки, по двум причинам. Первая — право: ссылку
   * получают зарегистрированные участники и организатор, а карточку события видит вся
   * его аудитория, и ссылка уезжала бы вместе с ней (включая кэш списка на клиенте).
   * Вторая — окно: «можно ли уже подключаться» зависит от текущего времени, то есть от
   * момента запроса, а не от момента, когда список был загружен.
   */
  async meeting(viewer: JwtPayload, id: string): Promise<EventMeeting> {
    const event = await this.prisma.event.findFirst({
      where: { id, ...eventVisibilityWhere(viewer) },
      select: {
        organizerId: true,
        startsAt: true,
        endsAt: true,
        meetingProvider: true,
        meetingUrl: true,
        meetingPasscode: true,
        participants: { where: { userId: viewer.sub }, select: { id: true } },
      },
    })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
    if (!event.meetingUrl || !event.meetingProvider) {
      throw new AppException('NOT_FOUND', 'У события нет онлайн-встречи')
    }
    // Организатор — всегда; остальным нужна регистрация. Это не формальность: по ссылке
    // на встречу заходят без второй проверки, и раздать её шире аудитории события нельзя.
    const registered = event.participants.length > 0 || event.organizerId === viewer.sub
    if (!registered) {
      throw new AppException('FORBIDDEN', 'Ссылка доступна зарегистрированным участникам')
    }

    const window = joinWindow(event.startsAt, event.endsAt)
    const now = Date.now()
    return {
      provider: event.meetingProvider as EventMeeting['provider'],
      url: event.meetingUrl,
      passcode: event.meetingPasscode,
      joinableFrom: window.from.toISOString(),
      joinableUntil: window.until.toISOString(),
      joinable: now >= window.from.getTime() && now <= window.until.getTime(),
    }
  }

  // ── Создание/изменение (задача 10.2) ────────────────────────────────────────

  async create(actor: JwtPayload, input: CreateEventInput, ctx: RequestContext): Promise<EventRow> {
    const target = await this.resolveTarget(actor, input.audience as PostAudience, input)
    const event = await this.prisma.event.create({
      data: {
        organizerId: actor.sub,
        audience: input.audience as PostAudience,
        title: input.title,
        description: input.description,
        location: input.location,
        // Ссылка на встречу сама по себе делает событие онлайновым: держать два
        // несогласованных признака одного и того же — источник «онлайн-события без
        // ссылки» и «ссылки у очного события».
        isOnline: input.meetingUrl ? true : (input.isOnline ?? false),
        ...meetingFields(input.meetingUrl, input.meetingPasscode),
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        ...target,
      },
      select: EVENT_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'event_created',
      entity: 'Event',
      entityId: event.id,
      metadata: { audience: input.audience },
      ...ctx,
    })
    return event
  }

  async update(
    actor: JwtPayload,
    id: string,
    input: UpdateEventInput,
    ctx: RequestContext,
  ): Promise<EventRow> {
    const event = await this.findManageable(actor, id)
    const startsAt = input.startsAt ? new Date(input.startsAt) : event.startsAt
    const endsAt =
      input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : event.endsAt
    if (endsAt && endsAt <= startsAt) {
      throw new AppException('BAD_REQUEST', 'Окончание должно быть позже начала')
    }
    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        location: input.location,
        isOnline: input.meetingUrl ? true : input.isOnline,
        ...(input.meetingUrl !== undefined || input.meetingPasscode !== undefined
          ? meetingFields(input.meetingUrl, input.meetingPasscode)
          : {}),
        startsAt: input.startsAt ? startsAt : undefined,
        endsAt: input.endsAt !== undefined ? endsAt : undefined,
        // Перенесли начало — напоминание о новом времени должно уйти заново.
        ...(startsAt.getTime() !== event.startsAt.getTime() ? { reminderSentAt: null } : {}),
      },
      select: EVENT_SELECT,
    })
    await this.audit.record({
      userId: actor.sub,
      action: 'event_updated',
      entity: 'Event',
      entityId: id,
      ...ctx,
    })
    return updated
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    await this.findManageable(actor, id)
    await this.prisma.event.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'event_deleted',
      entity: 'Event',
      entityId: id,
      ...ctx,
    })
  }

  // ── Регистрация (задача 10.3) ───────────────────────────────────────────────

  async register(viewer: JwtPayload, id: string): Promise<{ registered: boolean }> {
    // Регистрироваться можно только на видимое событие.
    await this.getById(viewer, id)
    await this.prisma.eventParticipant
      .create({ data: { eventId: id, userId: viewer.sub } })
      .catch((e) => {
        // Повторная регистрация — не ошибка (идемпотентно).
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
      })
    return { registered: true }
  }

  async cancelRegistration(viewer: JwtPayload, id: string): Promise<{ registered: boolean }> {
    await this.prisma.eventParticipant.deleteMany({ where: { eventId: id, userId: viewer.sub } })
    return { registered: false }
  }

  /** Список участников — только организатору и админам scope. */
  async listParticipants(viewer: JwtPayload, id: string) {
    await this.findManageable(viewer, id)
    return this.prisma.eventParticipant.findMany({
      where: { eventId: id },
      select: { userId: true, createdAt: true, user: ORGANIZER_SELECT },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    })
  }

  // ── Комментарии (§3.5) ──────────────────────────────────────────────────────

  /**
   * Комментарии видит вся аудитория события — то же правило, что у самой карточки. Отдаём
   * последние сто, по порядку написания: обсуждение под событием короткое, а в длинном
   * важнее свежие вопросы, чем первые.
   */
  async listComments(viewer: JwtPayload, id: string) {
    await this.assertVisible(viewer, id)
    const rows = await this.prisma.eventComment.findMany({
      where: { eventId: id, deletedAt: null },
      select: COMMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: COMMENTS_LIMIT,
    })
    return rows.reverse()
  }

  async addComment(viewer: JwtPayload, id: string, input: CreateEventCommentInput) {
    await this.assertVisible(viewer, id)
    return this.prisma.eventComment.create({
      data: { eventId: id, authorId: viewer.sub, content: input.content },
      select: COMMENT_SELECT,
    })
  }

  /**
   * Удалить комментарий: автор — свой; организатор — любой под своим событием; админ,
   * модератор и декан — по правилам модерации постов (canModerateComment). Удаление мягкое,
   * как у комментариев к постам.
   */
  async removeComment(
    viewer: JwtPayload,
    id: string,
    commentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const comment = await this.prisma.eventComment.findFirst({
      where: { id: commentId, eventId: id, deletedAt: null },
      select: {
        id: true,
        authorId: true,
        author: { select: { role: true, universityId: true, facultyId: true } },
      },
    })
    if (!comment) throw new AppException('NOT_FOUND', 'Комментарий не найден')
    if (
      comment.authorId !== viewer.sub &&
      !(await this.canModerateComment(viewer, id, comment.author))
    ) {
      throw new AppException('FORBIDDEN', 'Нет прав на удаление комментария')
    }
    await this.prisma.eventComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    })
    // Чужой комментарий удаляют властью организатора или модератора — это решение модерации.
    if (comment.authorId !== viewer.sub) {
      await this.audit.record({
        userId: viewer.sub,
        action: 'event_comment_deleted',
        entity: 'EventComment',
        entityId: commentId,
        metadata: { eventId: id, authorId: comment.authorId },
        ...ctx,
      })
    }
  }

  // ── Напоминания за час (задача 10.4, вызывается из CleanupService) ─────────

  async remindDue(): Promise<number> {
    const now = Date.now()
    const from = new Date(now + REMINDER_WINDOW_MIN.from * 60_000)
    const to = new Date(now + REMINDER_WINDOW_MIN.to * 60_000)
    let total = 0
    for (;;) {
      const events = await this.prisma.event.findMany({
        where: { reminderSentAt: null, startsAt: { gte: from, lte: to } },
        select: { id: true, title: true, startsAt: true },
        take: BATCH,
      })
      if (events.length === 0) break
      for (const event of events) {
        let cursor: string | undefined
        let page = 0
        for (;;) {
          const participants = await this.prisma.eventParticipant.findMany({
            where: { eventId: event.id },
            select: { id: true, userId: true },
            orderBy: { id: 'asc' },
            take: PARTICIPANTS_BATCH,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          })
          if (participants.length === 0) break
          await this.queue.enqueue(
            QUEUES.NOTIFICATIONS,
            NOTIFICATION_JOBS.EVENT_REMINDER,
            {
              recipientIds: participants.map((p) => p.userId),
              type: 'EVENT',
              titleKey: 'events.reminder.title',
              bodyKey: 'events.reminder.body',
              params: { title: event.title },
              // Карточка события, а не общий список: в напоминании речь об одном событии.
              data: { eventId: event.id, url: `/events/${event.id}` },
              // dedupeKey один на событие и его время начала: повторная доставка отсекается по
              // (пользователь, ключ), а перенесённое событие напоминает о себе заново. jobId
              // разный — иначе BullMQ отбросил бы все страницы кроме первой.
              dedupeKey: `event-reminder:${event.id}:${event.startsAt.getTime()}`,
            },
            { jobId: `event-reminder:${event.id}:${event.startsAt.getTime()}:${page}` },
          )
          if (participants.length < PARTICIPANTS_BATCH) break
          cursor = participants.at(-1)?.id
          page += 1
        }
        total += 1
      }
      // Помечаем отправленными сразу (дедуп на уровне записи + dedupeKey job'а).
      await this.prisma.event.updateMany({
        where: { id: { in: events.map((e) => e.id) } },
        data: { reminderSentAt: new Date() },
      })
      if (events.length < BATCH) break
    }
    if (total > 0) this.logger.log(`scheduleEventReminders: обработано событий ${total}`)
    return total
  }

  // ── Внутреннее ────────────────────────────────────────────────────────────

  /** Событие видно зрителю — иначе NOT_FOUND (не раскрываем существование чужих событий). */
  private async assertVisible(viewer: JwtPayload, id: string): Promise<void> {
    const event = await this.prisma.event.findFirst({
      where: { id, ...eventVisibilityWhere(viewer) },
      select: { id: true },
    })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
  }

  /**
   * Может ли зритель удалить чужой комментарий под событием. Организатор ведёт обсуждение
   * своего события — убирает любой комментарий. Остальное — модерация по правилам постов
   * (posts.service assertModerator): роль строго выше автора комментария; платформа — везде;
   * админ и модератор вуза — свой вуз, декан — свой факультет. Scope — событие ИЛИ сам автор:
   * комментарий своего студента под событием платформы (без вуза) снимает и модератор вуза.
   */
  private async canModerateComment(
    viewer: JwtPayload,
    id: string,
    author: { role: Role; universityId: string | null; facultyId: string | null },
  ): Promise<boolean> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: { organizerId: true, universityId: true, facultyId: true },
    })
    if (!event) return false
    if (event.organizerId === viewer.sub) return true
    if (!isHigherRole(viewer.role, author.role)) return false
    if (isPlatform(viewer.role)) return true
    const scopes = [event, author]
    if (viewer.role === Role.DEAN) {
      return !!viewer.facultyId && scopes.some((s) => s.facultyId === viewer.facultyId)
    }
    if (viewer.role === Role.UNIVERSITY_ADMIN || viewer.role === Role.UNIVERSITY_MODERATOR) {
      return !!viewer.universityId && scopes.some((s) => s.universityId === viewer.universityId)
    }
    return false
  }

  /** Событие + проверка прав управления (организатор или админ/декан своего scope). */
  private async findManageable(actor: JwtPayload, id: string): Promise<EventRow> {
    const event = await this.prisma.event.findUnique({ where: { id }, select: EVENT_SELECT })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
    if (event.organizerId === actor.sub) return event
    if (isPlatform(actor.role)) return event
    if (actor.role === Role.DEAN && event.facultyId && event.facultyId === actor.facultyId)
      return event
    if (
      actor.role === Role.UNIVERSITY_ADMIN &&
      event.universityId &&
      event.universityId === actor.universityId
    ) {
      return event
    }
    throw new AppException('FORBIDDEN', 'Нет прав на управление событием')
  }

  private async resolveTarget(
    actor: JwtPayload,
    audience: PostAudience,
    input: { facultyId?: string; groupId?: string },
  ): Promise<EventTarget> {
    if (!ALLOWED_AUDIENCES[actor.role].includes(audience)) {
      throw new AppException('FORBIDDEN', 'Эта аудитория недоступна вашей роли')
    }
    switch (audience) {
      case PostAudience.ALL:
        return {}
      case PostAudience.UNIVERSITY:
      case PostAudience.TEACHERS:
      case PostAudience.SUBJECT:
        return { universityId: this.requireUni(actor) }
      case PostAudience.FACULTY: {
        const facultyId = input.facultyId ?? actor.facultyId
        if (!facultyId) throw new AppException('BAD_REQUEST', 'Не указан факультет')
        return { facultyId, universityId: await this.assertFaculty(actor, facultyId) }
      }
      case PostAudience.GROUP: {
        const groupId = input.groupId ?? actor.groupId
        if (!groupId) throw new AppException('BAD_REQUEST', 'Не указана группа')
        const scope = await this.assertGroup(actor, groupId)
        return { groupId, facultyId: scope.facultyId, universityId: scope.universityId }
      }
      default:
        throw new AppException('BAD_REQUEST', 'Недопустимая аудитория события')
    }
  }

  private requireUni(actor: JwtPayload): string {
    if (!actor.universityId) throw new AppException('BAD_REQUEST', 'Нет привязки к университету')
    return actor.universityId
  }

  private async assertFaculty(actor: JwtPayload, facultyId: string): Promise<string> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { universityId: true },
    })
    if (!faculty) throw new AppException('NOT_FOUND', 'Факультет не найден')
    if (isPlatform(actor.role)) return faculty.universityId
    if (actor.role === Role.DEAN) {
      if (actor.facultyId !== facultyId) throw new AppException('WRONG_SCOPE', 'Чужой факультет')
    } else if (faculty.universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Факультет другого университета')
    }
    return faculty.universityId
  }

  private async assertGroup(
    actor: JwtPayload,
    groupId: string,
  ): Promise<{ facultyId: string; universityId: string }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { facultyId: true, faculty: { select: { universityId: true } } },
    })
    if (!group) throw new AppException('NOT_FOUND', 'Группа не найдена')
    const universityId = group.faculty.universityId
    if (isPlatform(actor.role)) return { facultyId: group.facultyId, universityId }
    if (actor.role === Role.STUDENT || actor.role === Role.STAROSTA) {
      if (actor.groupId !== groupId) throw new AppException('WRONG_SCOPE', 'Чужая группа')
    } else if (actor.role === Role.DEAN) {
      if (actor.facultyId !== group.facultyId)
        throw new AppException('WRONG_SCOPE', 'Чужой факультет')
    } else if (universityId !== actor.universityId) {
      throw new AppException('WRONG_SCOPE', 'Группа другого университета')
    }
    return { facultyId: group.facultyId, universityId }
  }
}

/**
 * Поля встречи для записи: провайдер считается из ссылки, `null` стирает встречу целиком.
 * Код доступа без ссылки не живёт — он к ней и относится.
 */
function meetingFields(
  url: string | null | undefined,
  passcode: string | null | undefined,
): { meetingUrl: string | null; meetingProvider: string | null; meetingPasscode: string | null } {
  if (!url) return { meetingUrl: null, meetingProvider: null, meetingPasscode: null }
  return {
    meetingUrl: url,
    meetingProvider: meetingProviderOf(url),
    meetingPasscode: passcode?.trim() ? passcode.trim() : null,
  }
}

/** Когда кнопка «Присоединиться» работает: [начало − 15 мин, конец + 30 мин]. */
function joinWindow(startsAt: Date, endsAt: Date | null): { from: Date; until: Date } {
  const end = endsAt ?? new Date(startsAt.getTime() + DEFAULT_DURATION_MIN * 60_000)
  return {
    from: new Date(startsAt.getTime() - JOIN_BEFORE_MIN * 60_000),
    until: new Date(end.getTime() + JOIN_AFTER_MIN * 60_000),
  }
}
