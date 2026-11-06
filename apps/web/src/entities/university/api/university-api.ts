import type {
  CreateUniversityInput,
  UniversityListQueryInput,
  UniversityStatusValue,
  UpdateUniversityInput,
  UpdateUniversityPageInput,
} from '@studenthub/shared-schemas'
import { api, getPaged } from '../../../shared/api'
import type { Paged } from '../../../shared/api'

export interface University {
  id: string
  name: string
  shortName: string | null
  status: 'PENDING' | 'ACTIVE' | 'BLOCKED'
  country: string | null
  city: string | null
  timezone: string
  createdAt: string
}

/** Страница университета (витрина в стиле профиля) — GET /universities/:id/page. */
export interface UniversityPage {
  id: string
  name: string
  shortName: string | null
  country: string | null
  /** Код КАТО или свободный текст (зарубежный вуз) — показывать через useKatoNames. */
  city: string | null
  logoUrl: string | null
  coverUrl: string | null
  description: string | null
  website: string | null
  foundedYear: number | null
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  telegram: string | null
  instagram: string | null
  linkedin: string | null
  createdAt: string
  /** Смотрящий публикует от имени вуза (админ или модератор своего вуза). */
  canPublish: boolean
  /** Смотрящий правит страницу (админ своего вуза). */
  canEdit: boolean
}

export interface UniversityStats {
  faculties: number
  groups: number
  rooms: number
  students: number
  teachers: number
}

export const universityKeys = {
  all: ['university'] as const,
  // Параметры — часть ключа: страница, поиск и порядок задают разные выборки, и кэш
  // не должен выдавать одну за другую.
  list: (query: Partial<UniversityListQueryInput> = {}) => ['university', 'list', query] as const,
  detail: (id: string) => ['university', id] as const,
  stats: (id: string) => ['university', id, 'stats'] as const,
  page: (id: string) => ['university', id, 'page'] as const,
}

// ── Страница университета ────────────────────────────────────────────────────

// Свои, платформа и компании с допуском (иначе 404).
export async function fetchUniversityPage(id: string): Promise<UniversityPage> {
  const { data } = await api.get<UniversityPage>(`/universities/${id}/page`)
  return data
}

// Правит админ своего вуза — вуз берётся из токена.
export async function updateMyUniversityPage(
  input: UpdateUniversityPageInput,
): Promise<UniversityPage> {
  const { data } = await api.patch<UniversityPage>('/universities/my/page', input)
  return data
}

export type UniversityImageKind = 'logo' | 'cover'

export async function uploadUniversityImage(
  kind: UniversityImageKind,
  file: Blob,
): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ url: string }>(`/universities/my/page/${kind}`, form)
  return data
}

export async function removeUniversityImage(kind: UniversityImageKind): Promise<void> {
  await api.delete(`/universities/my/page/${kind}`)
}

/**
 * Страница списка вузов: поиск, отбор, сортировка и пагинация считаются на сервере.
 *
 * Раньше здесь стоял зашитый `limit: 100`, а `meta.total` отбрасывался — при 200 вузах
 * админка показывала первую сотню и подписывала её «Вузов: 100», то есть молча врала.
 */
export async function fetchUniversities(
  query: Partial<UniversityListQueryInput> = {},
): Promise<Paged<University>> {
  return getPaged<University>('/universities', { page: 1, limit: 20, ...query })
}

export async function fetchUniversity(id: string): Promise<University> {
  const { data } = await api.get<University>(`/universities/${id}`)
  return data
}

export async function createUniversityRequest(input: CreateUniversityInput): Promise<University> {
  const { data } = await api.post<University>('/universities', input)
  return data
}

export async function updateUniversityRequest(
  id: string,
  input: UpdateUniversityInput,
): Promise<University> {
  const { data } = await api.patch<University>(`/universities/${id}`, input)
  return data
}

// Удаляется только пустой вуз: с факультетами, аудиториями или людьми сервер отвечает CONFLICT.
export async function deleteUniversityRequest(id: string): Promise<void> {
  await api.delete(`/universities/${id}`)
}

export async function setUniversityStatusRequest(
  id: string,
  status: UniversityStatusValue,
): Promise<University> {
  const { data } = await api.patch<University>(`/universities/${id}/status`, { status })
  return data
}

export async function fetchUniversityStats(id: string): Promise<UniversityStats> {
  const { data } = await api.get<UniversityStats>(`/universities/${id}/stats`)
  return data
}
