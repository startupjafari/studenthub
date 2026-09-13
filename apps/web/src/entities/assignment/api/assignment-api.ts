import type {
  AssignmentListQueryInput,
  CreateAssignmentInput,
  GradeSubmissionInput,
  ReturnSubmissionInput,
  SaveSubmissionDraftInput,
  UpdateAssignmentInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { AssignmentItem, SubmissionItem } from '../model/types'

export const assignmentKeys = {
  reviewQueue: (limit: number) => ['assignments', 'review-queue', limit] as const,
  all: ['assignments'] as const,
  listPaged: (filters: Partial<AssignmentListQueryInput>) =>
    ['assignments', 'list-paged', filters] as const,
  list: (filters: Partial<AssignmentListQueryInput> = {}) =>
    ['assignments', 'list', filters] as const,
  detail: (id: string) => ['assignments', 'detail', id] as const,
  submissions: (id: string) => ['assignments', id, 'submissions'] as const,
}

export async function fetchAssignments(
  filters: Partial<AssignmentListQueryInput> = {},
): Promise<AssignmentItem[]> {
  const { data } = await api.get<AssignmentItem[]>('/assignments', {
    params: { page: 1, limit: 100, ...filters },
  })
  return data
}

/**
 * Страница заданий с общим числом — для таблицы преподавателя.
 *
 * Отдельно от `fetchAssignments`: тот отдаёт массив и используется ещё на четырёх
 * экранах (календарь, задачи, курс, список студента), которым ни `total`, ни
 * сортировка не нужны. Менять его форму значило бы править их все ради одной таблицы.
 */
export async function fetchAssignmentsPaged(
  query: Partial<AssignmentListQueryInput> = {},
): Promise<Paged<AssignmentItem>> {
  return getPaged<AssignmentItem>('/assignments', { page: 1, limit: 20, ...query })
}

export async function fetchAssignment(id: string): Promise<AssignmentItem> {
  const { data } = await api.get<AssignmentItem>(`/assignments/${id}`)
  return data
}

export async function fetchSubmissions(assignmentId: string): Promise<SubmissionItem[]> {
  const { data } = await api.get<SubmissionItem[]>(`/assignments/${assignmentId}/submissions`)
  return data
}

// ── Преподаватель ────────────────────────────────────────────────────────────
export async function createAssignmentRequest(
  input: CreateAssignmentInput,
): Promise<AssignmentItem> {
  const { data } = await api.post<AssignmentItem>('/assignments', input)
  return data
}

export async function updateAssignmentRequest(
  id: string,
  input: UpdateAssignmentInput,
): Promise<AssignmentItem> {
  const { data } = await api.patch<AssignmentItem>(`/assignments/${id}`, input)
  return data
}

export async function publishAssignmentRequest(id: string): Promise<AssignmentItem> {
  const { data } = await api.post<AssignmentItem>(`/assignments/${id}/publish`)
  return data
}

export async function closeAssignmentRequest(id: string): Promise<AssignmentItem> {
  const { data } = await api.post<AssignmentItem>(`/assignments/${id}/close`)
  return data
}

export async function deleteAssignmentRequest(id: string): Promise<void> {
  await api.delete(`/assignments/${id}`)
}

export async function gradeSubmissionRequest(
  id: string,
  input: GradeSubmissionInput,
): Promise<SubmissionItem> {
  const { data } = await api.post<SubmissionItem>(`/submissions/${id}/grade`, input)
  return data
}

export async function returnSubmissionRequest(
  id: string,
  input: ReturnSubmissionInput,
): Promise<SubmissionItem> {
  const { data } = await api.post<SubmissionItem>(`/submissions/${id}/return`, input)
  return data
}

// ── Студент ──────────────────────────────────────────────────────────────────
export async function saveSubmissionDraftRequest(
  assignmentId: string,
  input: SaveSubmissionDraftInput,
): Promise<SubmissionItem> {
  const { data } = await api.put<SubmissionItem>(`/assignments/${assignmentId}/submission`, input)
  return data
}

export async function submitAssignmentRequest(assignmentId: string): Promise<SubmissionItem> {
  const { data } = await api.post<SubmissionItem>(`/assignments/${assignmentId}/submit`)
  return data
}

/** Очередь проверки преподавателя: сколько работ ждёт оценки и по каким заданиям. */
export interface ReviewQueue {
  total: number
  items: {
    id: string
    title: string
    subject: string | null
    dueAt: string | null
    pending: number
  }[]
}

export async function fetchReviewQueue(limit = 5): Promise<ReviewQueue> {
  const { data } = await api.get<ReviewQueue>('/assignments/review-queue', { params: { limit } })
  return data
}
