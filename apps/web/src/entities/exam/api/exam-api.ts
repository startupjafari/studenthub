import type {
  CreateExamInput,
  ExamListQueryInput,
  SetExamResultsInput,
  UpdateExamInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ExamItem, ExamRoster } from '../model/types'

export const examKeys = {
  all: ['exams'] as const,
  list: (filters: Partial<ExamListQueryInput> = {}) => ['exams', 'list', filters] as const,
  detail: (id: string) => ['exams', 'detail', id] as const,
  results: (id: string) => ['exams', id, 'results'] as const,
}

export async function fetchExams(filters: Partial<ExamListQueryInput> = {}): Promise<ExamItem[]> {
  const { data } = await api.get<ExamItem[]>('/exams', { params: filters })
  return data
}

export async function fetchExam(id: string): Promise<ExamItem> {
  const { data } = await api.get<ExamItem>(`/exams/${id}`)
  return data
}

export async function fetchExamResults(id: string): Promise<ExamRoster> {
  const { data } = await api.get<ExamRoster>(`/exams/${id}/results`)
  return data
}

export async function createExamRequest(input: CreateExamInput): Promise<ExamItem> {
  const { data } = await api.post<ExamItem>('/exams', input)
  return data
}

export async function updateExamRequest(id: string, input: UpdateExamInput): Promise<ExamItem> {
  const { data } = await api.patch<ExamItem>(`/exams/${id}`, input)
  return data
}

export async function deleteExamRequest(id: string): Promise<void> {
  await api.delete(`/exams/${id}`)
}

export async function setExamResultsRequest(input: SetExamResultsInput): Promise<ExamRoster> {
  const { data } = await api.put<ExamRoster>('/exams/results', input)
  return data
}
