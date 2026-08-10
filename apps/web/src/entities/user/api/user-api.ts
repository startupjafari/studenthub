import type { AxiosProgressEvent } from 'axios'
import type {
  UpdateProfileInput,
  ChangePasswordInput,
  UserListQueryInput,
  ProfileVisibilityValue,
} from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'
import { api } from '../../../shared/api'
import type { MeResponse } from '../../../shared/api'

export const userKeys = {
  me: () => ['user', 'me'] as const,
  detail: (id: string) => ['user', 'detail', id] as const,
  presence: (id: string) => ['user', 'presence', id] as const,
}

export async function fetchMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/users/me')
  return data
}

// Статус присутствия пользователя (в сети / не в сети) — снапшот; живые апдейты через WS.
export async function fetchUserPresence(id: string): Promise<{ online: boolean }> {
  const { data } = await api.get<{ online: boolean }>(`/users/${id}/presence`)
  return data
}

// Публичный профиль другого пользователя (GET /users/:id). email/phone приходят null,
// если смотрящему их видеть нельзя (фильтрация на бэкенде, docs/PROJECT.md §3.7, §11.3).
// access='limited' — «закрытый профиль»: пришла только визитка (детали скрыты, docs §3.7).
export interface PublicUser {
  id: string
  access: 'full' | 'limited'
  profileVisibility: ProfileVisibilityValue
  email: string | null
  phone: string | null
  firstName: string
  lastName: string
  middleName: string | null
  avatarUrl: string | null
  avatarThumbUrl: string | null
  coverUrl: string | null
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  createdAt: string
  bio: string | null
  birthDate: string | null
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null
  languages: string[]
  telegram: string | null
  instagram: string | null
  website: string | null
  headline: string | null
  timezone: string | null
  country: string | null
  course: number | null
  enrollmentYear: number | null
  graduationYear: number | null
  educationLevel: string | null
  studyForm: string | null
  fundingType: string | null
  specialty: string | null
  academicStatus: string | null
  gpa: number | null
  interests: string[]
  skills: string[]
  dormitory: string | null
  starostaSince: string | null
  duties: string | null
  position: string | null
  academicDegree: string | null
  academicTitle: string | null
  department: string | null
  subjects: string[]
  officeRoom: string | null
  officeHours: string | null
  researchInterests: string | null
  publicationsUrl: string | null
  appointmentDate: string | null
  workPhone: string | null
  jobTitle: string | null
  responsibilities: string | null
  moderationAreas: string | null
}

export async function fetchUserById(id: string): Promise<PublicUser> {
  const { data } = await api.get<PublicUser>(`/users/${id}`)
  return data
}

export async function updateProfileRequest(input: UpdateProfileInput): Promise<MeResponse> {
  const { data } = await api.patch<MeResponse>('/users/me', input)
  return data
}

export async function changePasswordRequest(input: ChangePasswordInput): Promise<void> {
  await api.patch('/users/me/password', input)
}

export async function deleteAccountRequest(): Promise<void> {
  await api.delete('/users/me')
}

export async function uploadAvatarRequest(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MeResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<MeResponse>('/users/me/avatar', form, {
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
  return data
}

export async function removeAvatarRequest(): Promise<MeResponse> {
  const { data } = await api.delete<MeResponse>('/users/me/avatar')
  return data
}

export async function uploadCoverRequest(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MeResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<MeResponse>('/users/me/cover', form, {
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
  return data
}

export async function removeCoverRequest(): Promise<MeResponse> {
  const { data } = await api.delete<MeResponse>('/users/me/cover')
  return data
}

// ── Админ-список пользователей (Ф12.2) ──────────────────────────────────────

export interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Role
  avatarUrl: string | null
  avatarThumbUrl: string | null
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  isBlocked: boolean
  createdAt: string
}

export const adminUserKeys = {
  all: ['admin-users'] as const,
  list: (filters: Partial<UserListQueryInput>) => ['admin-users', 'list', filters] as const,
}

export async function fetchUsers(query: Partial<UserListQueryInput> = {}): Promise<AdminUser[]> {
  const { data } = await api.get<AdminUser[]>('/users', {
    params: { page: 1, limit: 100, ...query },
  })
  return data
}

export async function blockUserRequest(id: string): Promise<void> {
  await api.patch(`/users/${id}/block`)
}

export async function unblockUserRequest(id: string): Promise<void> {
  await api.patch(`/users/${id}/unblock`)
}
