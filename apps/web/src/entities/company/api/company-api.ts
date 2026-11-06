import type {
  CompanyListQueryInput,
  CompanyUniversityDirectoryQueryInput,
  DecideCompanyAccessInput,
  AcceptCompanyInviteInput,
  EmployerSignupInput,
  RequestCompanyAccessInput,
  UpdateCompanyInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type {
  Company,
  CompanyInvitePreview,
  CompanyTeam,
  CompanyPage,
  CompanyAccess,
  CompanyUniversityOption,
  UniversityCompanyAccess,
} from '../model/types'

export const companyKeys = {
  all: ['company'] as const,
  mine: () => ['company', 'mine'] as const,
  page: (id: string) => ['company', 'page', id] as const,
  myAccess: () => ['company', 'access'] as const,
  team: () => ['company', 'team'] as const,
  invitePreview: (token: string) => ['company', 'invite-preview', token] as const,
  universityOptions: (params: Partial<CompanyUniversityDirectoryQueryInput>) =>
    ['company', 'universities', params] as const,
  universityAccess: (params: Partial<CompanyListQueryInput> = {}) =>
    ['company', 'university-access', params] as const,
}

// ── Публичное: регистрация и подтверждение почты ─────────────────────────────

export async function employerSignup(input: EmployerSignupInput): Promise<{ email: string }> {
  const { data } = await api.post<{ email: string }>('/career/companies/signup', input)
  return data
}

export async function verifyCompanyEmail(token: string): Promise<{ companyId: string }> {
  const { data } = await api.post<{ companyId: string }>('/career/companies/verify-email', {
    token,
  })
  return data
}

// Новая ссылка подтверждения взамен истёкшей. Ответ одинаков для любого адреса — сервер не
// говорит, есть ли такая компания.
export async function resendCompanyVerification(email: string): Promise<void> {
  await api.post('/career/companies/resend-verification', { email })
}

// Приглашение в команду компании (21.D2): предпросмотр и регистрация по ссылке из письма.
export async function previewCompanyInvite(token: string): Promise<CompanyInvitePreview> {
  const { data } = await api.get<CompanyInvitePreview>(
    `/career/companies/invites/${encodeURIComponent(token)}/preview`,
  )
  return data
}

/** Регистрация по приглашению: отдаёт access-токен, refresh — cookie (как у инвайта вуза). */
export async function acceptCompanyInvite(input: AcceptCompanyInviteInput): Promise<string> {
  const { data } = await api.post<{ accessToken: string }>(
    '/auth/register-by-company-invite',
    input,
  )
  return data.accessToken
}

// ── Работодатель ─────────────────────────────────────────────────────────────

export async function fetchMyCompany(): Promise<Company> {
  const { data } = await api.get<Company>('/career/companies/me')
  return data
}

export async function updateMyCompany(input: UpdateCompanyInput): Promise<Company> {
  const { data } = await api.patch<Company>('/career/companies/me', input)
  return data
}

// ── Команда компании (только владелец) ───────────────────────────────────────

export async function fetchCompanyTeam(): Promise<CompanyTeam> {
  const { data } = await api.get<CompanyTeam>('/career/companies/me/members')
  return data
}

export async function inviteCompanyMember(email: string): Promise<void> {
  await api.post('/career/companies/me/invites', { email })
}

export async function revokeCompanyInvite(id: string): Promise<void> {
  await api.delete(`/career/companies/me/invites/${id}`)
}

export async function removeCompanyMember(userId: string): Promise<void> {
  await api.delete(`/career/companies/me/members/${userId}`)
}

/** Картинка страницы компании: логотип (аватар) или обложка. Меняет только владелец. */
export type CompanyImageKind = 'logo' | 'cover'

export async function uploadCompanyImage(
  kind: CompanyImageKind,
  file: Blob,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ url: string }>(`/career/companies/me/${kind}`, form)
  return data
}

export async function removeCompanyImage(kind: CompanyImageKind): Promise<void> {
  await api.delete(`/career/companies/me/${kind}`)
}

// Страница компании — сотрудникам, платформе и вузам с действующим допуском (иначе 404).
export async function fetchCompanyPage(id: string): Promise<CompanyPage> {
  const { data } = await api.get<CompanyPage>(`/career/companies/${id}`)
  return data
}

export async function fetchMyCompanyAccess(): Promise<CompanyAccess[]> {
  const { data } = await api.get<CompanyAccess[]>('/career/companies/me/access')
  return data
}

// Таблица вузов работодателя: поиск, фильтр по своей заявке, сортировка и страницы — на сервере.
export function fetchCompanyUniversityOptions(
  params: Partial<CompanyUniversityDirectoryQueryInput> = {},
): Promise<Paged<CompanyUniversityOption>> {
  return getPaged<CompanyUniversityOption>('/career/companies/me/universities', {
    page: 1,
    limit: 20,
    ...params,
  })
}

export async function requestCompanyAccess(
  input: RequestCompanyAccessInput,
): Promise<CompanyAccess[]> {
  const { data } = await api.post<CompanyAccess[]>('/career/companies/me/access', input)
  return data
}

// ── Вуз: очередь заявок ──────────────────────────────────────────────────────

export function fetchUniversityCompanyAccess(
  params: Partial<CompanyListQueryInput> = {},
): Promise<Paged<UniversityCompanyAccess>> {
  return getPaged<UniversityCompanyAccess>('/career/university/companies', {
    page: 1,
    limit: 20,
    ...params,
  })
}

export async function decideCompanyAccess(
  id: string,
  input: DecideCompanyAccessInput,
): Promise<void> {
  await api.patch(`/career/university/companies/${id}`, input)
}
