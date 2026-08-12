import type {
  AssignmentListQueryInput,
  CreateAssignmentInput,
  GradeSubmissionInput,
  ReturnSubmissionInput,
  SaveSubmissionDraftInput,
  UpdateAssignmentInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { AssignmentItem, SubmissionItem } from '../model/types'

export const assignmentKeys = {
  all: ['assignments'] as const,
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
