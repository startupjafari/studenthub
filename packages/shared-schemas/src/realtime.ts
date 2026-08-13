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
  gradePublished: 'grade.published',
} as const
export type RealtimeEventType = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS]
