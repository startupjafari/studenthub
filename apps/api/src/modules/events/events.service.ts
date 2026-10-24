import { Injectable, Logger } from '@nestjs/common'
import { PostAudience, Prisma } from '@prisma/client'
import { Role, isHigherRole } from '@studenthub/shared-types'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import {
  DEFAULT_PAGE_LIMIT,
  isPageRequested,
  meetingProviderOf,
  type CommentsQueryInput,
  type CreateEventCommentInput,
  type CreateEventInput,
  type EventListQueryInput,
  type EventMeeting,
  type EventParticipantsQueryInput,
  type UpdateEventInput,
} from '@studenthub/shared-schemas'
import { eventAccessWhere } from './event-visibility'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import {
  NEWEST_FIRST,
  OLDEST_FIRST,
  encodeKeyset,
  keysetFrom,
  newerThan,
  olderThan,
} from '../../common/http/keyset-cursor'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import { localDateTimeLabel } from '../../common/time/local-label'

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
  // Охрана и библиотекарь событий не создают.
  [Role.SECURITY_GUARD]: [],
  [Role.LIBRARIAN]: [],
}

// Окно напоминаний за час (docs/BACKEND_RULES.md §9.3): (now, now+70м] — всё, что ещё не
// началось и о чём ещё не напомнили. Раньше окно было щелью [now+55м, now+70м] шириной ровно
// в шаг крона (15 минут): каждое событие попадало в один-единственный тик, и пропущенный тик
// (деплой, рестарт, занятый лок) или событие, созданное или перенесённое на «через 40 минут»,
// не получали напоминания никогда. Верхняя граница прежняя: обычное событие по-прежнему
// напоминает о себе за 55–70 минут, а ближнее — на первом же тике. Повтор отсекает
// reminderSentAt (и dedupeKey job'а).
const REMINDER_AHEAD_MIN = 70
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
  careerKind: true,
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

// Событие для управления: карточка + текущая встреча. Ссылка нужна частичной правке
// (поля встречи применяются к тому, что уже сохранено); наружу эта строка не уходит.
const MANAGEABLE_SELECT = {
  ...EVENT_SELECT,
  meetingUrl: true,
  meetingPasscode: true,
} satisfies Prisma.EventSelect

type ManageableEvent = Prisma.EventGetPayload<{ select: typeof MANAGEABLE_SELECT }>

// Прежний ответ списка участников без `limit`/`cursor` — потолок одним массивом.
const PARTICIPANTS_LEGACY_LIMIT = 1000

// Потолок обсуждения под событием в одном ответе (BACKEND_RULES §5.3: findMany без take нельзя).
const COMMENTS_LIMIT = 100

const COMMENT_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  author: { select: { id: true, firstName: true, lastName: true, avatarThumbUrl: true } },
} satisfies Prisma.EventCommentSelect

// Для списка — плюс роль и scope автора: по ним считается `canDelete` (правило модерации).
// Наружу эти поля не уходят — их отрезает toCommentView.
const COMMENT_LIST_SELECT = {
  ...COMMENT_SELECT,
  author: {
    select: { ...COMMENT_SELECT.author.select, role: true, universityId: true, facultyId: true },
  },
} satisfies Prisma.EventCommentSelect

type CommentListRow = Prisma.EventCommentGetPayload<{ select: typeof COMMENT_LIST_SELECT }>

// Что нужно знать о событии, чтобы решить, кто им управляет и кто чистит обсуждение.
interface EventScope {
  organizerId: string
  universityId: string | null
  facultyId: string | null
}

interface CommentAuthorScope {
  role: Role
  universityId: string | null
  facultyId: string | null
}

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
    const timeWhere = endedWhere(new Date(), query.filter === 'past')
    const where: Prisma.EventWhereInput = {
      AND: [
        eventAccessWhere(viewer),
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
      canManage: canManageEvent(viewer, e),
    }))
    return new Paginated(items, { total })
  }

  async getById(viewer: JwtPayload, id: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, ...eventAccessWhere(viewer) },
      select: {
        ...EVENT_SELECT,
        participants: { where: { userId: viewer.sub }, select: { id: true } },
      },
    })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
    const { participants, ...rest } = event
    return {
      ...rest,
      isRegistered: participants.length > 0,
      // Право управления считает сервер тем же правилом, что и findManageable: кнопки
      // «Изменить/Удалить» и список участников в клиентах опираются на флаг, а не на роль.
      canManage: canManageEvent(viewer, rest),
    }
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
      where: { id, ...eventAccessWhere(viewer) },
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
        careerKind: input.careerKind ?? null,
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
    // Встреча правится частично: поле, которого нет в запросе, остаётся как было. Раньше
    // PATCH одного кода доступа стирал ссылку, а новая ссылка без кода — сам код.
    const meeting =
      input.meetingUrl !== undefined || input.meetingPasscode !== undefined
        ? meetingFields(
            input.meetingUrl === undefined ? event.meetingUrl : input.meetingUrl,
            input.meetingPasscode === undefined ? event.meetingPasscode : input.meetingPasscode,
          )
        : null
    const hasMeetingUrl = meeting ? meeting.meetingUrl !== null : !!event.meetingUrl
    const rescheduled = startsAt.getTime() !== event.startsAt.getTime()
    // Момент правки — в ключе уведомления о переносе: «туда и обратно» на прежнее время
    // иначе давало ключ, который у участника уже есть, и уведомление молча отбрасывалось.
    const changedAt = Date.now()
    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        location: input.location,
        // Есть ссылка — событие онлайновое (см. create); без ссылки признак ставит клиент.
        isOnline: hasMeetingUrl ? true : input.isOnline,
        ...(meeting ?? {}),
        startsAt: input.startsAt ? startsAt : undefined,
        endsAt: input.endsAt !== undefined ? endsAt : undefined,
        careerKind: input.careerKind,
        // Перенесли начало — напоминание о новом времени должно уйти заново.
        ...(rescheduled ? { reminderSentAt: null } : {}),
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
    // Участники записались на конкретное время — о переносе они должны узнать, а не
    // обнаружить его по пустой аудитории. Перенос в уже прошедшее время (правка архива)
    // никого не тревожит.
    const pages =
      rescheduled && !hasEnded(startsAt, endsAt, new Date())
        ? await this.participantPages(id, actor.sub)
        : []
    if (pages.length > 0) {
      const timezone = await this.timezoneOf(event.universityId)
      await this.notifyParticipants(pages, NOTIFICATION_JOBS.EVENT_RESCHEDULED, {
        titleKey: 'events.rescheduled.title',
        bodyKey: 'events.rescheduled.body',
        params: { title: updated.title, date: eventTimeLabel(startsAt, timezone) },
        data: { eventId: id, url: `/events/${id}` },
        // Ключ — на новое время и момент правки: каждый следующий перенос (и на прежнее
        // время тоже) — новое уведомление, а повторная доставка того же переноса отсекается.
        dedupeKey: `event-rescheduled:${id}:${startsAt.getTime()}:${changedAt}`,
      })
    }
    return updated
  }

  async remove(actor: JwtPayload, id: string, ctx: RequestContext): Promise<void> {
    const event = await this.findManageable(actor, id)
    // Участников собираем ДО удаления: строки регистраций уходят вместе с событием
    // (onDelete: Cascade). Удаление прошедшего события — уборка архива, а не отмена.
    const now = new Date()
    const pages = hasEnded(event.startsAt, event.endsAt, now)
      ? []
      : await this.participantPages(id, actor.sub)
    const timezone = pages.length > 0 ? await this.timezoneOf(event.universityId) : null
    await this.prisma.event.delete({ where: { id } })
    await this.audit.record({
      userId: actor.sub,
      action: 'event_deleted',
      entity: 'Event',
      entityId: id,
      ...ctx,
    })
    await this.notifyParticipants(pages, NOTIFICATION_JOBS.EVENT_CANCELLED, {
      titleKey: 'events.cancelled.title',
      bodyKey: 'events.cancelled.body',
      params: { title: event.title, date: eventTimeLabel(event.startsAt, timezone) },
      // Карточки больше нет — уведомление ведёт в общий список.
      data: { url: '/events' },
      dedupeKey: `event-cancelled:${id}`,
    })
  }

  // ── Регистрация (задача 10.3) ───────────────────────────────────────────────

  async register(viewer: JwtPayload, id: string): Promise<{ registered: boolean }> {
    // Регистрироваться можно только на видимое событие.
    const event = await this.getById(viewer, id)
    // На закончившееся — нельзя: участник прошедшего события получил бы ссылку на встречу,
    // которая уже прошла. Идущее событие ещё открыто — к онлайн-встрече подключаются и с
    // опозданием. Отменить участие можно всегда.
    if (hasEnded(event.startsAt, event.endsAt, new Date())) {
      throw new AppException('CONFLICT', 'Событие уже завершилось — регистрация закрыта')
    }
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

  /**
   * Список участников — только организатору и админам scope. Без `limit`/`cursor` — прежний
   * ответ массивом (так читают выпущенные клиенты); с ними — страница по порядку
   * регистрации, `meta.cursor` — позиция строки участия, на которой страница закончилась
   * (момент и id, keyset-cursor.ts: отменённая тем временем регистрация не обрывает листание).
   */
  async listParticipants(
    viewer: JwtPayload,
    id: string,
    query: EventParticipantsQueryInput = {},
  ): Promise<unknown[] | Paginated<unknown>> {
    await this.findManageable(viewer, id)
    if (!isPageRequested(query)) {
      return this.prisma.eventParticipant.findMany({
        where: { eventId: id },
        select: { userId: true, createdAt: true, user: ORGANIZER_SELECT },
        orderBy: { createdAt: 'asc' },
        take: PARTICIPANTS_LEGACY_LIMIT,
      })
    }
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT
    const after = query.cursor
      ? await keysetFrom(query.cursor, (cursorId) =>
          this.prisma.eventParticipant.findUnique({
            where: { id: cursorId },
            select: { createdAt: true, id: true },
          }),
        )
      : null
    if (query.cursor && !after) return new Paginated([], { hasNext: false })
    const rows = await this.prisma.eventParticipant.findMany({
      where: { eventId: id, ...(after ? newerThan(after) : {}) },
      select: { id: true, userId: true, createdAt: true, user: ORGANIZER_SELECT },
      // id — второй ключ: регистрации в одну миллисекунду иначе шли бы в случайном порядке
      // и терялись бы на стыке страниц.
      orderBy: OLDEST_FIRST,
      take: limit + 1,
    })
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return new Paginated(items, {
      cursor: hasNext && last ? encodeKeyset(last) : undefined,
      hasNext,
    })
  }

  // ── Комментарии (§3.5) ──────────────────────────────────────────────────────

  /**
   * Комментарии видит вся аудитория события — то же правило, что у самой карточки.
   *
   * Без `limit`/`cursor` — прежний ответ: последние сто по порядку написания (обсуждение
   * под событием короткое, а в длинном важнее свежие вопросы, чем первые). С ними —
   * страница свежих сверху: `meta.cursor` — самый старый комментарий страницы (по нему
   * просят более ранние), `meta.total` — сколько комментариев всего.
   *
   * У каждого комментария — `canDelete`: тот же расчёт, что в removeComment, чтобы клиент
   * не показывал корзину, которая ответит 403. Событие для расчёта читается один раз.
   */
  async listComments(
    viewer: JwtPayload,
    id: string,
    query: CommentsQueryInput = {},
  ): Promise<unknown[] | Paginated<unknown>> {
    const event = await this.prisma.event.findFirst({
      where: { id, ...eventAccessWhere(viewer) },
      select: { organizerId: true, universityId: true, facultyId: true },
    })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
    const where: Prisma.EventCommentWhereInput = { eventId: id, deletedAt: null }
    const view = (row: CommentListRow) => toCommentView(viewer, event, row)

    if (!isPageRequested(query)) {
      const rows = await this.prisma.eventComment.findMany({
        where,
        select: COMMENT_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        take: COMMENTS_LIMIT,
      })
      return rows.reverse().map(view)
    }

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT
    // Курсор несёт момент и id (keyset-cursor.ts): мягко удалённый курсорный комментарий
    // не проходит фильтр, и Prisma-курсор со `skip: 1` съедал бы соседний, живой.
    const after = query.cursor
      ? await keysetFrom(query.cursor, (cursorId) =>
          this.prisma.eventComment.findUnique({
            where: { id: cursorId },
            select: { createdAt: true, id: true },
          }),
        )
      : null
    const total = await this.prisma.eventComment.count({ where })
    if (query.cursor && !after) return new Paginated([], { hasNext: false, total })
    const rows = await this.prisma.eventComment.findMany({
      where: after ? { AND: [where, olderThan(after)] } : where,
      select: COMMENT_LIST_SELECT,
      orderBy: NEWEST_FIRST,
      take: limit + 1,
    })
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    return new Paginated(items.map(view), {
      cursor: hasNext && last ? encodeKeyset(last) : undefined,
      hasNext,
      total,
    })
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
    const now = new Date()
    const until = new Date(now.getTime() + REMINDER_AHEAD_MIN * 60_000)
    // Пояс вуза — один запрос на вуз за прогон, а не на событие.
    const zoneCache = new Map<string | null, string | null>()
    const zones = async (universityId: string | null): Promise<string | null> => {
      if (!zoneCache.has(universityId)) {
        zoneCache.set(universityId, await this.timezoneOf(universityId))
      }
      return zoneCache.get(universityId) ?? null
    }
    let total = 0
    let lastId: string | undefined
    for (;;) {
      const events = await this.prisma.event.findMany({
        where: {
          reminderSentAt: null,
          // Начавшемуся не напоминаем: «начнётся примерно через час» об идущем — неправда.
          // Отменённое событие удаляется целиком (remove) и сюда не попадает.
          startsAt: { gt: now, lte: until },
          // Keyset по id: помеченные события выпадают из выборки сами, а непомеченное
          // (начало перенесли посреди прогона) не читается по кругу.
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        select: { id: true, title: true, startsAt: true, updatedAt: true, universityId: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      })
      if (events.length === 0) break
      lastId = events.at(-1)?.id
      // Отметку получают только события, о которых напоминание поставлено целиком (все
      // страницы участников): при недоступном Redis отметка без job'а теряла напоминание
      // навсегда — следующий тик событие уже не выбирал (BACKEND_RULES §9.2).
      const queued: { id: string; startsAt: Date }[] = []
      let failed = false
      for (const event of events) {
        // Время начала по часам вуза: окно ловит и события через десять минут, и «примерно
        // через час» про них — неправда.
        const time = eventTimeLabel(event.startsAt, await zones(event.universityId)).slice(11)
        const reminderKey = `event-reminder:${event.id}:${event.startsAt.getTime()}:${event.updatedAt.getTime()}`
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
          const ok = await this.queue.enqueue(
            QUEUES.NOTIFICATIONS,
            NOTIFICATION_JOBS.EVENT_REMINDER,
            {
              recipientIds: participants.map((p) => p.userId),
              type: 'EVENT',
              titleKey: 'events.reminder.title',
              bodyKey: 'events.reminder.bodyAt',
              params: { title: event.title, time },
              // Карточка события, а не общий список: в напоминании речь об одном событии.
              data: { eventId: event.id, url: `/events/${event.id}` },
              // dedupeKey один на версию события (время начала и момент последней правки):
              // повторная доставка отсекается по (пользователь, ключ), а перенесённое событие
              // напоминает о себе заново — и при переносе обратно на уже напомненное время.
              // jobId разный — иначе BullMQ отбросил бы все страницы кроме первой.
              dedupeKey: reminderKey,
            },
            { jobId: `${reminderKey}:${page}` },
          )
          if (!ok) {
            failed = true
            break
          }
          if (participants.length < PARTICIPANTS_BATCH) break
          cursor = participants.at(-1)?.id
          page += 1
        }
        // Очередь недоступна — дальше не идём: остальные события (и это, с начала)
        // подхватит следующий тик, повтор страниц отсечёт dedupeKey.
        if (failed) break
        queued.push({ id: event.id, startsAt: event.startsAt })
        total += 1
      }
      // Помечаем отправленными сразу (дедуп на уровне записи + dedupeKey job'а) — но только ту
      // версию события, о которой напомнили. Если начало успели перенести посреди прогона,
      // update уже сбросил reminderSentAt: отметка не ляжет, и следующий тик напомнит о новом
      // времени под новым dedupeKey, а не проглотит его чужой отметкой.
      if (queued.length > 0) {
        await this.prisma.event.updateMany({
          where: {
            reminderSentAt: null,
            OR: queued.map((e) => ({ id: e.id, startsAt: e.startsAt })),
          },
          data: { reminderSentAt: new Date() },
        })
      }
      if (failed) {
        this.logger.warn('scheduleEventReminders: очередь недоступна — остаток на следующий тик')
        break
      }
      if (events.length < BATCH) break
    }
    if (total > 0) this.logger.log(`scheduleEventReminders: обработано событий ${total}`)
    return total
  }

  // ── Внутреннее ────────────────────────────────────────────────────────────

  /** Событие видно зрителю — иначе NOT_FOUND (не раскрываем существование чужих событий). */
  private async assertVisible(viewer: JwtPayload, id: string): Promise<void> {
    const event = await this.prisma.event.findFirst({
      where: { id, ...eventAccessWhere(viewer) },
      select: { id: true },
    })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
  }

  /** Может ли зритель удалить чужой комментарий под событием (canModerateEventComment). */
  private async canModerateComment(
    viewer: JwtPayload,
    id: string,
    author: CommentAuthorScope,
  ): Promise<boolean> {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: { organizerId: true, universityId: true, facultyId: true },
    })
    return !!event && canModerateEventComment(viewer, event, author)
  }

  /** Событие + проверка прав управления (организатор или админ/декан своего scope). */
  private async findManageable(actor: JwtPayload, id: string): Promise<ManageableEvent> {
    const event = await this.prisma.event.findUnique({ where: { id }, select: MANAGEABLE_SELECT })
    if (!event) throw new AppException('NOT_FOUND', 'Событие не найдено')
    if (!canManageEvent(actor, event)) {
      throw new AppException('FORBIDDEN', 'Нет прав на управление событием')
    }
    return event
  }

  /**
   * Участники события страницами (кроме автора изменения — он и так знает), для рассылки.
   * Обрезать список потолком нельзя, тянуть одним findMany — тоже (см. PARTICIPANTS_BATCH).
   */
  private async participantPages(eventId: string, exceptUserId: string): Promise<string[][]> {
    const pages: string[][] = []
    let cursor: string | undefined
    for (;;) {
      const rows = await this.prisma.eventParticipant.findMany({
        where: { eventId, userId: { not: exceptUserId } },
        select: { id: true, userId: true },
        orderBy: { id: 'asc' },
        take: PARTICIPANTS_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (rows.length > 0) pages.push(rows.map((r) => r.userId))
      if (rows.length < PARTICIPANTS_BATCH) break
      cursor = rows.at(-1)?.id
    }
    return pages
  }

  /**
   * Уведомление участникам через очередь `notifications`: job на каждую страницу. dedupeKey
   * общий — повторная доставка отсекается по (пользователь, ключ); jobId у страниц разный,
   * иначе BullMQ отбросил бы все страницы кроме первой (как в remindDue). Постановка не
   * бросает: удаление или перенос уже записаны, рассылка — best-effort (QueueService).
   */
  private async notifyParticipants(
    pages: string[][],
    jobName: string,
    message: {
      titleKey: NotificationMessageKey
      bodyKey: NotificationMessageKey
      params: Record<string, string>
      data: Record<string, string>
      dedupeKey: string
    },
  ): Promise<void> {
    for (const [page, recipientIds] of pages.entries()) {
      await this.queue.enqueue(
        QUEUES.NOTIFICATIONS,
        jobName,
        { recipientIds, type: 'EVENT', ...message },
        { jobId: `${message.dedupeKey}:${page}` },
      )
    }
  }

  /**
   * Часовой пояс вуза события — время в тексте уведомления. У события платформы вуза нет, а
   * участники из разных вузов: время уходит в UTC с пометкой (eventTimeLabel).
   */
  private async timezoneOf(universityId: string | null): Promise<string | null> {
    if (!universityId) return null
    const university = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: { timezone: true },
    })
    return university?.timezone ?? null
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
 * Может ли актор управлять событием (правка, удаление, список участников): организатор;
 * платформа — везде; декан — событие своего факультета; админ вуза — своего вуза.
 * Одно правило для проверки в findManageable и для флага `canManage` в ответах.
 */
export function canManageEvent(actor: JwtPayload, event: EventScope): boolean {
  if (event.organizerId === actor.sub) return true
  if (isPlatform(actor.role)) return true
  if (actor.role === Role.DEAN) return !!event.facultyId && event.facultyId === actor.facultyId
  if (actor.role === Role.UNIVERSITY_ADMIN) {
    return !!event.universityId && event.universityId === actor.universityId
  }
  return false
}

/**
 * Может ли зритель удалить чужой комментарий под событием. Организатор ведёт обсуждение
 * своего события — убирает любой комментарий. Остальное — модерация по правилам постов
 * (posts.service assertModerator): роль строго выше автора комментария; платформа — везде;
 * админ и модератор вуза — свой вуз, декан — свой факультет. Scope — событие ИЛИ сам автор:
 * комментарий своего студента под событием платформы (без вуза) снимает и модератор вуза.
 */
function canModerateEventComment(
  viewer: JwtPayload,
  event: EventScope,
  author: CommentAuthorScope,
): boolean {
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

/** Комментарий для ответа: без роли и scope автора, с флагом `canDelete`. */
function toCommentView(viewer: JwtPayload, event: EventScope, row: CommentListRow) {
  const { role, universityId, facultyId, ...author } = row.author
  const canDelete =
    author.id === viewer.sub ||
    canModerateEventComment(viewer, event, { role: role as Role, universityId, facultyId })
  return { ...row, author, canDelete }
}

/**
 * Время события для текста уведомления — по часам вуза. Без пояса (событие платформы, вуз не
 * указал пояс) — UTC с пометкой: голые «10:00» читались по своим часам и врали на пять часов.
 */
function eventTimeLabel(date: Date, timezone: string | null): string {
  const label = localDateTimeLabel(date, timezone)
  return timezone ? label : `${label} UTC`
}

/** Конец события: указанный или начало + длительность по умолчанию. */
function eventEnd(startsAt: Date, endsAt: Date | null): Date {
  return endsAt ?? new Date(startsAt.getTime() + DEFAULT_DURATION_MIN * 60_000)
}

function hasEnded(startsAt: Date, endsAt: Date | null, now: Date): boolean {
  return eventEnd(startsAt, endsAt).getTime() < now.getTime()
}

/**
 * Фильтр «прошедшие/предстоящие» по КОНЦУ события, а не по началу: идущее онлайн-событие,
 * к которому ещё можно подключиться, раньше уезжало в «Прошедшие» в минуту начала.
 * Без указанного конца — начало + длительность по умолчанию (как в eventEnd).
 */
function endedWhere(now: Date, ended: boolean): Prisma.EventWhereInput {
  const defaultStart = new Date(now.getTime() - DEFAULT_DURATION_MIN * 60_000)
  return ended
    ? { OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: defaultStart } }] }
    : { OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: defaultStart } }] }
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
  const end = eventEnd(startsAt, endsAt)
  return {
    from: new Date(startsAt.getTime() - JOIN_BEFORE_MIN * 60_000),
    until: new Date(end.getTime() + JOIN_AFTER_MIN * 60_000),
  }
}
