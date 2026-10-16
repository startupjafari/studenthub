import type {
  AssignmentListQueryInput,
  CreateAssignmentInput,
  GradeSubmissionInput,
  ReturnSubmissionInput,
  SaveSubmissionDraftInput,
  UpdateAssignmentInput,
} from '@studenthub/shared-schemas'
import type { AxiosProgressEvent } from 'axios'
import {
  api,
  getPaged,
  needsDirectUpload,
  uploadDirect,
  type Paged,
  type PresignedTarget,
} from '../../../shared/api'
import type { AssignmentItem, SubmissionFile, SubmissionItem } from '../model/types'

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

/**
 * Приложить файл к работе. Как у материалов: до порога — буферная загрузка через API,
 * больше — прямая в MinIO по подписанной ссылке. Черновика сдачи нет — сервер заведёт его.
 */
export async function uploadSubmissionFileRequest(
  assignmentId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<SubmissionFile> {
  const base = `/assignments/${assignmentId}/submission/files`
  if (needsDirectUpload(file.size)) {
    return uploadDirect<SubmissionFile>({
      file,
      presign: async (mime) => {
        const { data } = await api.post<PresignedTarget>(`${base}/presign`, { mime })
        return data
      },
      confirm: async (key, name) => {
        const { data } = await api.post<SubmissionFile>(`${base}/confirm`, { key, name })
        return data
      },
      onProgress,
    })
  }
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<SubmissionFile>(base, form, {
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return data
}

export async function deleteSubmissionFileRequest(
  assignmentId: string,
  fileId: string,
): Promise<void> {
  await api.delete(`/assignments/${assignmentId}/submission/files/${fileId}`)
}

/** Ссылка на скачивание файла работы (автору и проверяющему), с исходным именем файла. */
export async function fetchSubmissionFileUrl(
  submissionId: string,
  fileId: string,
): Promise<string> {
  const { data } = await api.get<{ url: string }>(
    `/submissions/${submissionId}/files/${fileId}/presigned`,
  )
  return data.url
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
