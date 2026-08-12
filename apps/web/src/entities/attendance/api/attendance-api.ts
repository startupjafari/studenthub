import type { AttendanceSummaryQueryInput, MarkAttendanceInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type {
  AttendanceQrToken,
  AttendanceRoster,
  AttendanceSummary,
  CheckInResult,
} from '../model/types'

export const attendanceKeys = {
  all: ['attendance'] as const,
  roster: (pairId: string, date: string) => ['attendance', 'roster', pairId, date] as const,
  me: (query: Partial<AttendanceSummaryQueryInput> = {}) => ['attendance', 'me', query] as const,
  qr: (pairId: string, date: string) => ['attendance', 'qr', pairId, date] as const,
}

export async function fetchRoster(pairId: string, date: string): Promise<AttendanceRoster> {
  const { data } = await api.get<AttendanceRoster>('/attendance/roster', {
    params: { pairId, date },
  })
  return data
}

export async function markAttendanceRequest(input: MarkAttendanceInput): Promise<AttendanceRoster> {
  const { data } = await api.put<AttendanceRoster>('/attendance', input)
  return data
}

export async function fetchMyAttendance(
  query: Partial<AttendanceSummaryQueryInput> = {},
): Promise<AttendanceSummary> {
  const { data } = await api.get<AttendanceSummary>('/attendance/me', { params: query })
  return data
}

export async function fetchAttendanceQr(pairId: string, date: string): Promise<AttendanceQrToken> {
  const { data } = await api.get<AttendanceQrToken>('/attendance/qr', { params: { pairId, date } })
  return data
}

export async function checkInRequest(token: string): Promise<CheckInResult> {
  const { data } = await api.post<CheckInResult>('/attendance/check-in', { token })
  return data
}
