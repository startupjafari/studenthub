import type { Role } from '@studenthub/shared-types'
import type { RegisterByInviteInput, ProfileVisibilityValue } from '@studenthub/shared-schemas'
import { api } from './instance'

// Тонкие обёртки над auth-эндпоинтами. Интерцептор instance разворачивает конверт {success,data}.

export interface MeResponse {
  id: string
  email: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: Role
  showEmail: boolean
  // Видимость профиля целиком («закрытый профиль», docs/PROJECT.md §3.7).
  profileVisibility?: ProfileVisibilityValue
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  // Расширенный профиль (стиль ВК). Поля могут отсутствовать в ответе /auth/me — потому опциональны.
  middleName?: string | null
  showPhone?: boolean
  phone?: string | null
  createdAt?: string
  bio?: string | null
  birthDate?: string | null
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | null
  languages?: string[]
  telegram?: string | null
  instagram?: string | null
  website?: string | null
  headline?: string | null
  timezone?: string | null
  country?: string | null
  // студент / староста
  course?: number | null
  enrollmentYear?: number | null
  graduationYear?: number | null
  educationLevel?: string | null
  studyForm?: string | null
  fundingType?: string | null
  specialty?: string | null
  studentCardNumber?: string | null
  academicStatus?: string | null
  gpa?: number | null
  interests?: string[]
  skills?: string[]
  dormitory?: string | null
  address?: string | null
  starostaSince?: string | null
  duties?: string | null
  // сотрудники
  position?: string | null
  academicDegree?: string | null
  academicTitle?: string | null
  department?: string | null
  subjects?: string[]
  officeRoom?: string | null
  officeHours?: string | null
  employeeNumber?: string | null
  researchInterests?: string | null
  publicationsUrl?: string | null
  appointmentDate?: string | null
  workPhone?: string | null
  jobTitle?: string | null
  responsibilities?: string | null
  moderationAreas?: string | null
}

export interface InvitePreview {
  role: Role
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  expiresAt: string
}

export async function loginRequest(email: string, password: string): Promise<string> {
  const { data } = await api.post<{ accessToken: string }>('/auth/login', { email, password })
  return data.accessToken
}

export async function registerByInviteRequest(input: RegisterByInviteInput): Promise<string> {
  const { data } = await api.post<{ accessToken: string }>('/auth/register-by-invite', input)
  return data.accessToken
}

export async function previewInviteRequest(token: string): Promise<InvitePreview> {
  const { data } = await api.get<InvitePreview>(`/invites/${token}/preview`)
  return data
}

export async function meRequest(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>('/auth/me')
  return data
}

export async function logoutRequest(): Promise<void> {
  await api.post('/auth/logout')
}
