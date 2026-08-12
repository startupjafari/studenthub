import { api } from '../../../shared/api'
import type { MyStudentId, VerifiedStudentId } from '../model/types'

export const studentIdKeys = {
  all: ['student-id'] as const,
  mine: () => ['student-id', 'mine'] as const,
  verify: (token: string) => ['student-id', 'verify', token] as const,
}

export async function fetchMyStudentId(): Promise<MyStudentId> {
  const { data } = await api.get<MyStudentId>('/student-id/me')
  return data
}

export async function verifyStudentId(token: string): Promise<VerifiedStudentId> {
  const { data } = await api.get<VerifiedStudentId>('/student-id/verify', { params: { token } })
  return data
}
