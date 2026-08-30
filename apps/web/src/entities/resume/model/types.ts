// Типы домена «Резюме» — зеркало ответов API (GET /career/resume).

export interface ResumeSettings {
  title: string
  published: boolean
  publicSlug: string | null
  includeContacts: boolean
  updatedAt: string | null
}

export interface ResumeItem {
  title: string
  organization: string | null
  period: string | null
  description: string | null
  /** Подтверждено вузом — главное отличие от самозаявленной записи. */
  verified: boolean
}

/** Публичное резюме по ссылке. Контакты приходят пустыми, если студент их не включил. */
export interface PublicResume {
  title: string
  updatedAt: string | null
  fullName: string
  headline: string | null
  contacts: string[]
  about: string | null
  education: string[]
  skills: string[]
  languages: string[]
  experience: ResumeItem[]
  projects: ResumeItem[]
  certificates: ResumeItem[]
}
