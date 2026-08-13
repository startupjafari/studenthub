// Единый контракт активности/timeline (docs/UNIFIED_UX.md PR-9/#14). Общий DTO ПОВЕРХ
// разрозненных журналов (ApplicationEvent / DocumentEvent / AuditLog) — без слияния таблиц.
// Output-only: сервер читает источники и маппит в этот вид; валидации входа нет.

export type ActivitySource = 'application' | 'document' | 'audit'

export interface Activity {
  // Глобально уникальный id вида `${source}:${rawId}` (источники не пересекаются).
  id: string
  source: ActivitySource
  // Сырое действие журнала (STATUS_CHANGED, UPLOAD, LOGIN, …).
  action: string
  // Тип и id затронутой сущности (Application / Document / audit.entity).
  entityType: string
  entityId: string
  // Кто инициировал (если известно).
  actorId: string | null
  // Момент события, ISO-8601.
  ts: string
  // Доп. контекст источника (fromStatus/toStatus/comment у заявок, metadata у прочих).
  meta: Record<string, unknown> | null
}
