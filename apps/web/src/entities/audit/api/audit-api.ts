import { api } from '../../../shared/api'

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
  list: (action?: string) => ['audit', 'list', action ?? 'all'] as const,
}

export async function fetchAudit(
  params: { action?: string; page?: number; limit?: number } = {},
): Promise<AuditLogItem[]> {
  const { data } = await api.get<AuditLogItem[]>('/audit', {
    params: { page: 1, limit: 50, ...params },
  })
  return data
}
