import type {
  CreateDocumentRequestInput,
  ReviewSubmissionItemInput,
  SaveSubmissionInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export const documentRequestKeys = {
  all: ['document-requests'] as const,
  authored: () => ['document-requests', 'authored'] as const,
  manage: (id: string) => ['document-requests', 'manage', id] as const,
  submission: (id: string) => ['document-requests', 'submission', id] as const,
  mine: () => ['document-requests', 'mine'] as const,
  detail: (id: string) => ['document-requests', 'detail', id] as const,
}

export interface RequestItem {
  id: string
  documentType: string
  title: string
  required: boolean
  order: number
}
export interface RequestTarget {
  id: string
  targetType: string
  targetId: string | null
}

// ── Сотрудник ──────────────────────────────────────────────────────────────
export interface StaffRequestSummary {
  id: string
  title: string
  dueAt: string | null
  status: string
  createdAt: string
  itemCount: number
  targetCount: number
  submissionCount: number
  submittedCount: number
}
export interface StaffSubmissionSummary {
  id: string
  status: string
  submittedAt: string | null
  reviewedAt: string | null
  studentId: string
  studentName: string
  itemCount: number
}
export interface StaffRequestDetail {
  id: string
  title: string
  description: string | null
  dueAt: string | null
  status: string
  createdAt: string
  items: RequestItem[]
  targets: RequestTarget[]
  submissions: StaffSubmissionSummary[]
}
export interface SubmissionItemDoc {
  id: string
  title: string
  type: string
  numberMasked: string | null
  fileCount: number
  files: { id: string; mime: string }[]
}
export interface StaffSubmissionItem {
  id: string
  status: string
  rejectionReason: string | null
  requestItemId: string
  requestItemTitle: string
  documentType: string
  required: boolean
  document: SubmissionItemDoc | null
}
export interface StaffSubmissionDetail {
  id: string
  status: string
  submittedAt: string | null
  reviewedAt: string | null
  requestId: string
  requestTitle: string
  studentId: string
  studentName: string
  items: StaffSubmissionItem[]
}

// ── Студент ────────────────────────────────────────────────────────────────
export interface StudentRequestSummary {
  id: string
  title: string
  dueAt: string | null
  status: string
  createdAt: string
  itemCount: number
  requiredCount: number
  filledRequired: number
  submissionStatus: string | null
}
export interface StudentSubmissionItem {
  requestItemId: string
  status: string
  rejectionReason: string | null
  document: { id: string; title: string; type: string } | null
}
export interface StudentSubmission {
  id: string
  status: string
  submittedAt: string | null
  items: StudentSubmissionItem[]
}
export interface StudentRequestDetail {
  id: string
  title: string
  description: string | null
  dueAt: string | null
  status: string
  createdAt: string
  items: RequestItem[]
  submission: StudentSubmission | null
}

// ── Сотрудник: запросы ───────────────────────────────────────────────────────
export async function createDocumentRequest(
  input: CreateDocumentRequestInput,
): Promise<StaffRequestDetail> {
  const { data } = await api.post<StaffRequestDetail>('/document-requests', input)
  return data
}
export async function fetchAuthoredRequests(): Promise<StaffRequestSummary[]> {
  const { data } = await api.get<StaffRequestSummary[]>('/document-requests/authored')
  return data
}
export async function fetchRequestManage(id: string): Promise<StaffRequestDetail> {
  const { data } = await api.get<StaffRequestDetail>(`/document-requests/manage/${id}`)
  return data
}
export async function fetchSubmission(submissionId: string): Promise<StaffSubmissionDetail> {
  const { data } = await api.get<StaffSubmissionDetail>(
    `/document-requests/submissions/${submissionId}`,
  )
  return data
}
export async function fetchSubmissionFileUrl(itemId: string, fileId: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(
    `/document-requests/submission-items/${itemId}/files/${fileId}/url`,
  )
  return data.url
}
export async function reviewSubmissionItem(
  itemId: string,
  input: ReviewSubmissionItemInput,
): Promise<StaffSubmissionDetail> {
  const { data } = await api.patch<StaffSubmissionDetail>(
    `/document-requests/submission-items/${itemId}/review`,
    input,
  )
  return data
}
export async function finalizeSubmission(submissionId: string): Promise<StaffSubmissionDetail> {
  const { data } = await api.post<StaffSubmissionDetail>(
    `/document-requests/submissions/${submissionId}/finalize`,
  )
  return data
}

// ── Студент: запросы ─────────────────────────────────────────────────────────
export async function fetchMyRequests(): Promise<StudentRequestSummary[]> {
  const { data } = await api.get<StudentRequestSummary[]>('/document-requests')
  return data
}
export async function fetchRequestForStudent(id: string): Promise<StudentRequestDetail> {
  const { data } = await api.get<StudentRequestDetail>(`/document-requests/${id}`)
  return data
}
export async function saveSubmission(
  id: string,
  input: SaveSubmissionInput,
): Promise<StudentRequestDetail> {
  const { data } = await api.put<StudentRequestDetail>(`/document-requests/${id}/submission`, input)
  return data
}
export async function submitSubmission(id: string): Promise<StudentRequestDetail> {
  const { data } = await api.post<StudentRequestDetail>(`/document-requests/${id}/submit`)
  return data
}
