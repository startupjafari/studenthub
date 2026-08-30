import type {
  CompanyListQueryInput,
  DecideCompanyAccessInput,
  EmployerSignupInput,
  RequestCompanyAccessInput,
  UpdateCompanyInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type {
  Company,
  CompanyAccess,
  CompanyUniversityOption,
  UniversityCompanyAccess,
} from '../model/types'

export const companyKeys = {
  all: ['company'] as const,
  mine: () => ['company', 'mine'] as const,
  myAccess: () => ['company', 'access'] as const,
  universityOptions: (search: string) => ['company', 'universities', search] as const,
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

// ── Работодатель ─────────────────────────────────────────────────────────────

export async function fetchMyCompany(): Promise<Company> {
  const { data } = await api.get<Company>('/career/companies/me')
  return data
}

export async function updateMyCompany(input: UpdateCompanyInput): Promise<Company> {
  const { data } = await api.patch<Company>('/career/companies/me', input)
  return data
}

export async function fetchMyCompanyAccess(): Promise<CompanyAccess[]> {
  const { data } = await api.get<CompanyAccess[]>('/career/companies/me/access')
  return data
}

export async function fetchCompanyUniversityOptions(
  search?: string,
): Promise<CompanyUniversityOption[]> {
  const { data } = await api.get<CompanyUniversityOption[]>('/career/companies/me/universities', {
    params: search ? { search } : undefined,
  })
  return data
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
