import type {
  CreateGradeColumnInput,
  SaveGradesInput,
  UpdateGradeColumnInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { GradeCell, GradeColumnItem, Gradebook, MyGradesCourse } from '../model/types'

export const gradebookKeys = {
  all: ['gradebook'] as const,
  course: (courseId: string) => ['gradebook', 'course', courseId] as const,
  me: () => ['gradebook', 'me'] as const,
}

export async function fetchGradebook(courseId: string): Promise<Gradebook> {
  const { data } = await api.get<Gradebook>(`/gradebook/course/${courseId}`)
  return data
}

export async function fetchMyGrades(): Promise<MyGradesCourse[]> {
  const { data } = await api.get<MyGradesCourse[]>('/gradebook/me')
  return data
}

export async function createColumnRequest(input: CreateGradeColumnInput): Promise<GradeColumnItem> {
  const { data } = await api.post<GradeColumnItem>('/gradebook/columns', input)
  return data
}

export async function updateColumnRequest(
  id: string,
  input: UpdateGradeColumnInput,
): Promise<GradeColumnItem> {
  const { data } = await api.patch<GradeColumnItem>(`/gradebook/columns/${id}`, input)
  return data
}

export async function publishColumnRequest(
  id: string,
  published: boolean,
): Promise<GradeColumnItem> {
  const { data } = await api.post<GradeColumnItem>(
    `/gradebook/columns/${id}/${published ? 'publish' : 'unpublish'}`,
  )
  return data
}

export async function deleteColumnRequest(id: string): Promise<void> {
  await api.delete(`/gradebook/columns/${id}`)
}

export async function saveGradesRequest(input: SaveGradesInput): Promise<GradeCell[]> {
  const { data } = await api.put<GradeCell[]>('/gradebook/grades', input)
  return data
}
