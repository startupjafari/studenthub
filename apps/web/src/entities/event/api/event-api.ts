import type {
  CreateEventInput,
  EventListQueryInput,
  EventMeeting,
  UpdateEventInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged, type ResponseWithMeta } from '../../../shared/api'
import type {
  EventComment,
  EventCommentsPage,
  EventItem,
  EventParticipant,
  EventParticipantsPage,
} from '../model/types'

const DEFAULT_EVENTS_LIMIT = 50
// Страница обсуждения под событием: ровно столько, сколько помещается на экран-другой.
const EVENT_COMMENTS_PAGE_SIZE = 20
// Страница участников — максимум, что отдаёт сервер (OptionalCursorPaginationSchema).
const EVENT_PARTICIPANTS_PAGE_SIZE = 50

export const eventKeys = {
  all: ['events'] as const,
  // limit — часть ключа: главная берёт 4 ближайших, «Мероприятия» и календарь — 50. С общим
  // ключом экран, открытый следом за главной, показывал из кэша её четыре события (E-F11).
  list: (filter: string, mine?: boolean, limit = DEFAULT_EVENTS_LIMIT) =>
    ['events', 'list', filter, mine ?? false, limit] as const,
  // Экран «Мероприятия» листает страницами: первые 50 молча обрезали остальное.
  pages: (filter: string) => ['events', 'pages', filter] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
  participants: (id: string) => ['events', id, 'participants'] as const,
  meeting: (id: string) => ['events', id, 'meeting'] as const,
  comments: (id: string) => ['events', id, 'comments'] as const,
}

export async function fetchEvents(query: Partial<EventListQueryInput> = {}): Promise<EventItem[]> {
  const { data } = await api.get<EventItem[]>('/events', {
    params: { page: 1, limit: DEFAULT_EVENTS_LIMIT, filter: 'upcoming', ...query },
  })
  return data
}

/** Страница списка с `total` — для экрана, который листает дальше первых пятидесяти. */
export async function fetchEventsPage(
  query: Partial<EventListQueryInput> = {},
): Promise<Paged<EventItem>> {
  return getPaged<EventItem>('/events', {
    page: 1,
    limit: DEFAULT_EVENTS_LIMIT,
    filter: 'upcoming',
    ...query,
  })
}

export async function fetchEvent(id: string): Promise<EventItem> {
  const { data } = await api.get<EventItem>(`/events/${id}`)
  return data
}

/**
 * Ссылка на онлайн-встречу. Отдельным запросом и только по нажатию: ссылку сервер
 * отдаёт лишь участникам, а окно подключения считается на момент запроса — в кэше
 * списка оно бы протухло.
 */
export async function fetchEventMeeting(id: string): Promise<EventMeeting> {
  const { data } = await api.get<EventMeeting>(`/events/${id}/meeting`)
  return data
}

export async function createEventRequest(input: CreateEventInput): Promise<EventItem> {
  const { data } = await api.post<EventItem>('/events', input)
  return data
}

export async function updateEventRequest(id: string, input: UpdateEventInput): Promise<EventItem> {
  const { data } = await api.patch<EventItem>(`/events/${id}`, input)
  return data
}

export async function deleteEventRequest(id: string): Promise<void> {
  await api.delete(`/events/${id}`)
}

export async function registerEventRequest(id: string): Promise<void> {
  await api.post(`/events/${id}/register`)
}

export async function cancelEventRequest(id: string): Promise<void> {
  await api.delete(`/events/${id}/register`)
}

export async function fetchEventParticipants(id: string): Promise<EventParticipant[]> {
  const { data } = await api.get<EventParticipant[]>(`/events/${id}/participants`)
  return data
}

/**
 * Участники страницами по порядку регистрации. Без `limit` сервер отдаёт прежний массив с
 * потолком в 1000 — у события вуза участников больше, и список молча обрезался.
 */
export async function fetchEventParticipantsPage(
  id: string,
  cursor?: string,
): Promise<EventParticipantsPage> {
  const res = (await api.get<EventParticipant[]>(`/events/${id}/participants`, {
    params: { limit: EVENT_PARTICIPANTS_PAGE_SIZE, cursor },
  })) as ResponseWithMeta & { data: EventParticipant[] }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
}

/**
 * Страница обсуждения: свежие сверху, `cursor` — по нему просят более ранние. Комментарии
 * видит вся аудитория события. Без `limit` сервер отдал бы прежний массив последних ста —
 * так читают мобильные клиенты; веб листает страницами (E-F12).
 */
export async function fetchEventComments(id: string, cursor?: string): Promise<EventCommentsPage> {
  const res = (await api.get<EventComment[]>(`/events/${id}/comments`, {
    params: { limit: EVENT_COMMENTS_PAGE_SIZE, cursor },
  })) as ResponseWithMeta & { data: EventComment[] }
  return {
    items: res.data,
    cursor: res.meta?.cursor,
    hasNext: res.meta?.hasNext ?? false,
    total: res.meta?.total,
  }
}

export async function addEventCommentRequest(id: string, content: string): Promise<EventComment> {
  const { data } = await api.post<EventComment>(`/events/${id}/comments`, { content })
  return data
}

export async function deleteEventCommentRequest(id: string, commentId: string): Promise<void> {
  await api.delete(`/events/${id}/comments/${commentId}`)
}
