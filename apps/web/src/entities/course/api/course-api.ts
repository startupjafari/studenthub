import type {
  CourseListQueryInput,
  CreateCourseInput,
  CreateSubjectInput,
  CreateTermInput,
  SubjectListQueryInput,
  TermListQueryInput,
  UpdateCourseInput,
  UpdateSubjectInput,
  UpdateTermInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { CourseItem, SubjectItem, TermItem } from '../model/types'

export const courseKeys = {
  all: ['courses'] as const,
  list: (filters: Partial<CourseListQueryInput> = {}) => ['courses', 'list', filters] as const,
  // Все дисциплины по фильтру, без обрезки первой страницей (выбор дисциплины в формах).
  // Признак `all` — внутри объекта фильтров: инвалидация `list()` задевает и эти ключи.
  listAll: (filters: Partial<CourseListQueryInput> = {}) =>
    ['courses', 'list', { ...filters, all: true }] as const,
  detail: (id: string) => ['courses', 'detail', id] as const,
  subjects: (params: Partial<SubjectListQueryInput> = {}) =>
    ['courses', 'subjects', params] as const,
  terms: (params: Partial<TermListQueryInput> = {}) => ['courses', 'terms', params] as const,
}

export async function fetchCourses(
  filters: Partial<CourseListQueryInput> = {},
): Promise<CourseItem[]> {
  const { data } = await api.get<CourseItem[]>('/courses', {
    params: { page: 1, limit: 100, ...filters },
  })
  return data
}

// Потолок страниц для `fetchAllCourses`: 20 × 100 — заведомо больше дисциплин факультета,
// но цикл всё равно должен иметь предел, а не верить `total`.
const ALL_COURSES_MAX_PAGES = 20

/**
 * Все дисциплины по фильтру — для выбора дисциплины в формах. `fetchCourses` отдаёт только
 * первую сотню по алфавиту, а у факультета их бывает сотни: в селекте оставались первые
 * буквы алфавита, и экзамен или задание по остальным назначить было нельзя. Первая
 * страница сообщает `total`, остальные читаются параллельно.
 */
export async function fetchAllCourses(
  filters: Partial<CourseListQueryInput> = {},
): Promise<CourseItem[]> {
  const limit = 100
  const first = await getPaged<CourseItem>('/courses', { ...filters, page: 1, limit })
  const pages = Math.min(Math.ceil(first.total / limit), ALL_COURSES_MAX_PAGES)
  if (pages <= 1) return first.items
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      getPaged<CourseItem>('/courses', { ...filters, page: i + 2, limit }),
    ),
  )
  // Без повторов: между запросами страницы могла появиться дисциплина и сдвинуть offset.
  const seen = new Set<string>()
  const out: CourseItem[] = []
  for (const c of [first, ...rest].flatMap((p) => p.items)) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

/**
 * То же, но со счётчиком: нужен таблице администратора, где есть постраничная навигация.
 * Отдельной функцией, а не заменой `fetchCourses` — тот отдаёт массив шести другим
 * экранам (селекты в модалках, журнал, учебный план), и менять им форму ответа незачем.
 */
export async function fetchCoursesPaged(
  filters: Partial<CourseListQueryInput> = {},
): Promise<Paged<CourseItem>> {
  return getPaged<CourseItem>('/courses', { page: 1, limit: 20, ...filters })
}

export async function fetchCourse(id: string): Promise<CourseItem> {
  const { data } = await api.get<CourseItem>(`/courses/${id}`)
  return data
}

export async function fetchSubjectsPaged(
  filters: Partial<SubjectListQueryInput> = {},
): Promise<Paged<SubjectItem>> {
  return getPaged<SubjectItem>('/subjects', { page: 1, limit: 20, ...filters })
}

export async function fetchTermsPaged(
  filters: Partial<TermListQueryInput> = {},
): Promise<Paged<TermItem>> {
  return getPaged<TermItem>('/terms', { page: 1, limit: 20, ...filters })
}

// ── Мутации (декан/админ вуза) ───────────────────────────────────────────────

export async function createSubjectRequest(input: CreateSubjectInput): Promise<SubjectItem> {
  const { data } = await api.post<SubjectItem>('/subjects', input)
  return data
}

export async function updateSubjectRequest(
  id: string,
  input: UpdateSubjectInput,
): Promise<SubjectItem> {
  const { data } = await api.patch<SubjectItem>(`/subjects/${id}`, input)
  return data
}

export async function deleteSubjectRequest(id: string): Promise<void> {
  await api.delete(`/subjects/${id}`)
}

export async function createTermRequest(input: CreateTermInput): Promise<TermItem> {
  const { data } = await api.post<TermItem>('/terms', input)
  return data
}

// Сервер сверяет итоговые даты с сохранёнными и держит один активный семестр в вузе.
export async function updateTermRequest(id: string, input: UpdateTermInput): Promise<TermItem> {
  const { data } = await api.patch<TermItem>(`/terms/${id}`, input)
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
