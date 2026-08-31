// Типы домена «Карьера — компании» — зеркало ответов API (GET /career/companies/*).
import type { CompanyAccessStatus, CompanyStatus } from '@studenthub/shared-schemas'

export interface Company {
  id: string
  name: string
  slug: string
  description: string | null
  website: string | null
  city: string | null
  logoUrl: string | null
  status: CompanyStatus
  blockedReason: string | null
  createdAt: string
}

/** Заявка компании в вуз — как её видит работодатель. */
export interface CompanyAccess {
  id: string
  status: CompanyAccessStatus
  message: string | null
  reason: string | null
  requestedAt: string
  decidedAt: string | null
  expiresAt: string | null
  university: { id: string; name: string; shortName: string | null; city: string | null }
}

/** Та же заявка глазами вуза: вместо университета — карточка компании. */
export interface UniversityCompanyAccess {
  id: string
  status: CompanyAccessStatus
  message: string | null
  reason: string | null
  requestedAt: string
  decidedAt: string | null
  expiresAt: string | null
  company: Pick<
    Company,
    'id' | 'name' | 'slug' | 'website' | 'city' | 'logoUrl' | 'description' | 'status'
  >
}

/** Вуз в справочнике «куда подать заявку» вместе со статусом собственной заявки. */
export interface CompanyUniversityOption {
  id: string
  name: string
  shortName: string | null
  city: string | null
  access: {
    status: CompanyAccessStatus
    expiresAt: string | null
    reason: string | null
  } | null
}
