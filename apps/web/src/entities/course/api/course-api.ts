import type {
  CourseListQueryInput,
  CreateCourseInput,
  CreateSubjectInput,
  CreateTermInput,
  UpdateCourseInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { CourseItem, SubjectItem, TermItem } from '../model/types'

export const courseKeys = {
  all: ['courses'] as const,
  list: (filters: Partial<CourseListQueryInput> = {}) => ['courses', 'list', filters] as const,
  detail: (id: string) => ['courses', 'detail', id] as const,
  subjects: (universityId?: string) => ['courses', 'subjects', universityId ?? 'all'] as const,
  terms: (universityId?: string) => ['courses', 'terms', universityId ?? 'all'] as const,
}

export async function fetchCourses(
  filters: Partial<CourseListQueryInput> = {},
): Promise<CourseItem[]> {
  const { data } = await api.get<CourseItem[]>('/courses', {
    params: { page: 1, limit: 100, ...filters },
  })
  return data
}

export async function fetchCourse(id: string): Promise<CourseItem> {
  const { data } = await api.get<CourseItem>(`/courses/${id}`)
  return data
}

export async function fetchSubjects(universityId?: string): Promise<SubjectItem[]> {
  const { data } = await api.get<SubjectItem[]>('/subjects', { params: { universityId } })
  return data
}

export async function fetchTerms(universityId?: string): Promise<TermItem[]> {
  const { data } = await api.get<TermItem[]>('/terms', { params: { universityId } })
  return data
}

// ── Мутации (декан/админ вуза) ───────────────────────────────────────────────

export async function createSubjectRequest(input: CreateSubjectInput): Promise<SubjectItem> {
  const { data } = await api.post<SubjectItem>('/subjects', input)
  return data
}

export async function deleteSubjectRequest(id: string): Promise<void> {
  await api.delete(`/subjects/${id}`)
}

export async function createTermRequest(input: CreateTermInput): Promise<TermItem> {
  const { data } = await api.post<TermItem>('/terms', input)
  return data
}

export async function deleteTermRequest(id: string): Promise<void> {
  await api.delete(`/terms/${id}`)
}

export async function createCourseRequest(input: CreateCourseInput): Promise<CourseItem> {
  const { data } = await api.post<CourseItem>('/courses', input)
  return data
}

export async function updateCourseRequest(
  id: string,
  input: UpdateCourseInput,
): Promise<CourseItem> {
  const { data } = await api.patch<CourseItem>(`/courses/${id}`, input)
  return data
}

export async function deleteCourseRequest(id: string): Promise<void> {
  await api.delete(`/courses/${id}`)
}
