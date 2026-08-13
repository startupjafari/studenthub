import { api } from '../../../shared/api'
import type { AtRiskStudents, FacultyOverview, GroupAttendance } from '../model/types'

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
