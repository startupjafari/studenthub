import { api } from '../../../shared/api'
import type {
  ActivityHeatmap,
  AtRiskStudents,
  ComplaintsLatency,
  FacultyOverview,
  GroupAttendance,
  InvitesFunnel,
  MultiSeries,
  PlatformInterval,
  PlatformOverview,
  TopActions,
  UniversitySize,
} from '../model/types'

export const analyticsKeys = {
  all: ['analytics'] as const,
  faculty: (facultyId?: string) => ['analytics', 'faculty', facultyId ?? 'self'] as const,
  atRisk: (facultyId?: string) => ['analytics', 'at-risk', facultyId ?? 'self'] as const,
  groupAttendance: (groupId: string) => ['analytics', 'group', groupId, 'attendance'] as const,
}

export async function fetchFacultyOverview(facultyId?: string): Promise<FacultyOverview> {
  const { data } = await api.get<FacultyOverview>('/analytics/faculty', {
    params: facultyId ? { facultyId } : undefined,
  })
  return data
}

export async function fetchGroupAttendance(groupId: string): Promise<GroupAttendance> {
  const { data } = await api.get<GroupAttendance>(`/analytics/group/${groupId}/attendance`)
  return data
}

export async function fetchAtRiskStudents(facultyId?: string): Promise<AtRiskStudents> {
  const { data } = await api.get<AtRiskStudents>('/analytics/at-risk', {
    params: facultyId ? { facultyId } : undefined,
  })
  return data
}

// ── Аналитика платформы ──────────────────────────────────────────────────────
// Период приходит из одного фильтра дашборда и одинаков для всех запросов —
// иначе плитки и графики показывали бы разные срезы.

export interface PlatformRange {
  from: string
  to: string
  interval?: PlatformInterval
}

export const platformAnalyticsKeys = {
  all: ['analytics', 'platform'] as const,
  overview: () => ['analytics', 'platform', 'overview'] as const,
  usersGrowth: (r: PlatformRange) => ['analytics', 'platform', 'users-growth', r] as const,
  activeUsers: (r: PlatformRange) => ['analytics', 'platform', 'active-users', r] as const,
  universitiesSize: () => ['analytics', 'platform', 'universities-size'] as const,
  complaintsFlow: (r: PlatformRange) => ['analytics', 'platform', 'complaints-flow', r] as const,
  complaintsLatency: (r: PlatformRange) =>
    ['analytics', 'platform', 'complaints-latency', r] as const,
  invitesFunnel: (r: PlatformRange) => ['analytics', 'platform', 'invites-funnel', r] as const,
  activityHeatmap: (r: PlatformRange) => ['analytics', 'platform', 'activity-heatmap', r] as const,
  topActions: (r: PlatformRange) => ['analytics', 'platform', 'top-actions', r] as const,
}

async function getPlatform<T>(path: string, params?: PlatformRange): Promise<T> {
  const { data } = await api.get<T>(`/analytics/platform/${path}`, { params })
  return data
}

export const fetchPlatformOverview = (): Promise<PlatformOverview> =>
  getPlatform<PlatformOverview>('overview')

export const fetchUsersGrowth = (r: PlatformRange): Promise<MultiSeries> =>
  getPlatform<MultiSeries>('users-growth', r)

export const fetchActiveUsers = (r: PlatformRange): Promise<MultiSeries> =>
  getPlatform<MultiSeries>('active-users', r)

export const fetchUniversitiesSize = (): Promise<{ items: UniversitySize[] }> =>
  getPlatform<{ items: UniversitySize[] }>('universities-size')

export const fetchComplaintsFlow = (r: PlatformRange): Promise<MultiSeries> =>
  getPlatform<MultiSeries>('complaints-flow', r)

export const fetchComplaintsLatency = (r: PlatformRange): Promise<ComplaintsLatency> =>
  getPlatform<ComplaintsLatency>('complaints-latency', r)

export const fetchInvitesFunnel = (r: PlatformRange): Promise<InvitesFunnel> =>
  getPlatform<InvitesFunnel>('invites-funnel', r)

export const fetchActivityHeatmap = (r: PlatformRange): Promise<ActivityHeatmap> =>
  getPlatform<ActivityHeatmap>('activity-heatmap', r)

export const fetchTopActions = (r: PlatformRange): Promise<TopActions> =>
  getPlatform<TopActions>('top-actions', r)
