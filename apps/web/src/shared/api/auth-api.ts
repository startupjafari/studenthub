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
  // Квадратное превью аватара (~128px); заполняется асинхронно, до готовности — null.
  avatarThumbUrl?: string | null
  coverUrl?: string | null
  role: Role
  showEmail: boolean
  // Видимость профиля целиком («закрытый профиль», docs/PROJECT.md §3.7).
  profileVisibility?: ProfileVisibilityValue
  // Включена ли 2FA (только владельцу; в /users/me и /auth/me).
  twoFactorEnabled?: boolean
  // Имя входа (Telegram-стиль). Только у владельца: в чужой карточке бэкенд его вырезает.
  // null — у зарегистрированных до появления фичи; такие входят только по email.
  username?: string | null
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
  // Инвайт выдан без адреса (ссылкой в мессенджер) — email обязана спросить форма
  // регистрации. Самого адреса в превью нет: оно публично по токену.
  emailRequired: boolean
  universityId: string | null
  facultyId: string | null
  groupId: string | null
  expiresAt: string
}

// Ответ логина: либо сессия (accessToken), либо требование второго шага 2FA.
export interface TwoFactorChallenge {
  twoFactorRequired: true
  challengeToken: string
}
export type LoginResult = { accessToken: string } | TwoFactorChallenge

export async function loginRequest(identifier: string, password: string): Promise<LoginResult> {
  const { data } = await api.post<LoginResult>('/auth/login', { identifier, password })
  return data
}

// Второй шаг входа: challenge + код (TOTP или backup) → accessToken.
export async function loginVerify2faRequest(challengeToken: string, code: string): Promise<string> {
  const { data } = await api.post<{ accessToken: string }>('/auth/login/2fa', {
    challengeToken,
    code,
  })
  return data.accessToken
}

// ── Управление 2FA (в настройках, требует авторизации) ───────────────────────
export interface TwoFactorSetupResponse {
  secret: string
  otpauthUrl: string
  qr: string
}

export async function setup2faRequest(): Promise<TwoFactorSetupResponse> {
  const { data } = await api.post<TwoFactorSetupResponse>('/auth/2fa/setup')
  return data
}

export async function enable2faRequest(code: string): Promise<{ backupCodes: string[] }> {
  const { data } = await api.post<{ backupCodes: string[] }>('/auth/2fa/enable', { code })
  return data
}

export async function disable2faRequest(code: string): Promise<void> {
  await api.post('/auth/2fa/disable', { code })
}

// ── Вход по QR ───────────────────────────────────────────────────────────────
export interface QrCreateResponse {
  qrId: string
  qr: string
  claimSecret: string
  expiresIn: number
}

export async function qrCreateRequest(): Promise<QrCreateResponse> {
  const { data } = await api.post<QrCreateResponse>('/auth/qr/create')
  return data
}

// Забор сессии десктопом после подтверждения телефоном → accessToken.
export async function qrClaimRequest(qrId: string, claimSecret: string): Promise<string> {
  const { data } = await api.post<{ accessToken: string }>('/auth/qr/claim', { qrId, claimSecret })
  return data.accessToken
}

// Подтверждение входа с залогиненного устройства (требует авторизации).
export async function qrApproveRequest(approveToken: string): Promise<void> {
  await api.post('/auth/qr/approve', { approveToken })
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
