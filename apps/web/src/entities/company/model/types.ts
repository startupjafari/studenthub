// Типы домена «Карьера — компании» — зеркало ответов API (GET /career/companies/*).
import type {
  CompanyAccessStatus,
  CompanyMemberRole,
  CompanySize,
  CompanyStatus,
} from '@studenthub/shared-schemas'

/** Витрина компании — то, что видит студент на её странице (GET /career/companies/:id). */
export interface CompanyPage {
  id: string
  name: string
  slug: string
  description: string | null
  website: string | null
  city: string | null
  logoUrl: string | null
  coverUrl: string | null
  industry: string | null
  size: CompanySize | null
  foundedYear: number | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  telegram: string | null
  instagram: string | null
  linkedin: string | null
  createdAt: string
  /** Смотрящий — сотрудник компании: на странице доступно создание контента. */
  isMember?: boolean
}

/** Участник команды компании (GET /career/companies/me/members, 21.D2). */
export interface CompanyMember {
  userId: string
  firstName: string
  lastName: string
  email: string
  role: CompanyMemberRole
  joinedAt: string
  /** Это сам смотрящий — себя исключить нельзя. */
  isMe: boolean
}

/** Ожидающее приглашение коллеги. `expired` — срок прошёл, ссылка уже не работает. */
export interface CompanyInvite {
  id: string
  email: string
  role: CompanyMemberRole
  expiresAt: string
  createdAt: string
  expired: boolean
}

export interface CompanyTeam {
  members: CompanyMember[]
  invites: CompanyInvite[]
}

/** Приглашение по ссылке из письма — до регистрации. Адрес — под маской. */
export interface CompanyInvitePreview {
  companyName: string
  email: string
  expiresAt: string
}

/** Своя компания (GET|PATCH /career/companies/me): витрина плюс служебные поля. */
export interface Company extends CompanyPage {
  status: CompanyStatus
  blockedReason: string | null
  /** Роль смотрящего в своей компании; есть только в ответах GET|PATCH /career/companies/me. */
  memberRole?: CompanyMemberRole | null
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
