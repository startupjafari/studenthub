// Единый конверт realtime-событий (docs/PROJECT.md §9, Unified UX PR-8/#12).
// Канал socket.io — REALTIME_CHANNEL ('event'); `type` в формате 'domain.entity.action'.
// Вводится ПАРАЛЛЕЛЬНО к именованным событиям (message:new, schedule:changed, …) — старые
// события не ломаются; клиенты мигрируют на конверт постепенно.

export interface RealtimeEnvelope<T = unknown> {
  type: string // 'domain.entity.action', напр. 'application.status.changed'
  entityId: string // id затронутой сущности
  version: number // версия схемы data для этого type (начинается с 1)
  ts: string // ISO-8601 момент события
  data: T // полезная нагрузка события
}

// Имя socket.io-канала для конверта.
export const REALTIME_CHANNEL = 'event'

// Канонические типы событий (расширяется по мере миграции именованных событий на конверт).
export const REALTIME_EVENTS = {
  scheduleLessonUpdated: 'schedule.lesson.updated',
  notificationCreated: 'notification.created',
  applicationStatusChanged: 'application.status.changed',
  // Очередь обработчиков (21.B3): заявку подали, сменили ей статус или назначили ответственного.
  // Адресаты — кто видит заявку в очереди (админ и модератор её вуза, деканы её факультета).
  applicationQueueChanged: 'application.queue.changed',
  gradePublished: 'grade.published',

  // ── Живые разделы (эпик «всё живое по сокету», docs/PROJECT.md §9.2d) ────────────────
  // Все — СИГНАЛЫ: в data только то, что не раскрывает содержимое (вид изменения, счётчики).
  // Клиент перечитывает данные своим запросом, а сервер отдаёт их по правам зрителя —
  // поэтому адресовать можно комнатой (вуз, группа), не проверяя права каждого.

  /** Опубликован пост. data: { audience, authorId }. Комнаты — по аудитории поста. */
  feedPostCreated: 'feed.post.created',
  /**
   * Пост изменился. data: { kind: 'edited' | 'deleted' | 'counters', reactions?, comments? }.
   * Счётчики склеиваются на сервере — не чаще раза в пару секунд на пост.
   */
  feedPostChanged: 'feed.post.changed',
  /** Под постом или статьёй добавили или удалили комментарий. data: { count }. */
  postCommentsChanged: 'post.comments.changed',
  /** У автора появилась или пропала история. data: { authorId }. */
  storiesChanged: 'stories.changed',
  /** Заявка в друзья пришла, принята, отклонена; дружба удалена. data: { kind }. Адресно. */
  friendsChanged: 'friends.changed',
  /** Событие вуза создано, изменено, удалено; сменилось число мест. data: { kind }. */
  eventChanged: 'event.changed',
  /** Задание курса выдано, изменено, сдано, проверено. data: { kind, courseId }. */
  assignmentChanged: 'assignment.changed',
  /** Отметка посещаемости изменилась. data: {}. Адресно студентам. */
  attendanceChanged: 'attendance.changed',
  /** Задача изменилась. data: { kind }. */
  taskChanged: 'task.changed',
  /** Документ или запрос документов изменился. data: { kind }. */
  documentChanged: 'document.changed',
  /** Книга выдана, продлена, возвращена, утеряна. data: { kind }. */
  libraryLoanChanged: 'library.loan.changed',
  /** Изменился список админ-раздела. data: { list: AdminLiveList }. Адресно ведущим список. */
  adminListChanged: 'admin.list.changed',
  /** Экзамен (сессия) назначен, перенесён, отменён; опубликованы результаты. data: { kind }. */
  examChanged: 'exam.changed',
  /**
   * Карьера: вакансия опубликована, изменена, закрыта; отклик подан, сменил статус.
   * data: { entity: 'vacancy' | 'application', kind }.
   */
  careerChanged: 'career.changed',
} as const

/** Админ-списки, которые обновляются по сокету (`admin.list.changed`). */
export const ADMIN_LIVE_LISTS = [
  'invites',
  'users',
  'complaints',
  'support',
  'demoRequests',
] as const
export type AdminLiveList = (typeof ADMIN_LIVE_LISTS)[number]
export type RealtimeEventType = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS]
