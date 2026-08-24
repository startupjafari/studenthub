import type { AuditListQueryInput } from '@studenthub/shared-schemas'
import { getPaged } from '../../../shared/api'
import type { Paged } from '../../../shared/api'

export interface AuditLogItem {
  id: string
  userId: string | null
  action: string
  entity: string | null
  entityId: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: Partial<AuditListQueryInput> = {}) => ['audit', 'list', params] as const,
}

// sort/order уходят на сервер: сортировка по всей выборке, а не по открытой странице.
export async function fetchAudit(
  params: Partial<AuditListQueryInput> = {},
): Promise<Paged<AuditLogItem>> {
  return getPaged<AuditLogItem>('/audit', { page: 1, limit: 20, ...params })
}
