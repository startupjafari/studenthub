import type {
  BookSlotInput,
  ConsultationMineQueryInput,
  CreateSlotInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { ConsultationSlot, ConsultationTeacher } from '../model/types'

export const consultationKeys = {
  all: ['consultations'] as const,
  // Параметры страницы и сортировки — часть ключа: иначе вторая страница показывала бы
  // закэшированную первую. Инвалидация после правок идёт по `all`.
  mine: (query?: Partial<ConsultationMineQueryInput>) =>
    ['consultations', 'mine', query ?? {}] as const,
  teachers: () => ['consultations', 'teachers'] as const,
  teacherSlots: (teacherId: string) => ['consultations', 'slots', teacherId] as const,
}

/** Страница моих консультаций: сортировка и пагинация считаются на сервере. */
export async function fetchMyConsultations(
  query: Partial<ConsultationMineQueryInput> = {},
): Promise<Paged<ConsultationSlot>> {
  return getPaged<ConsultationSlot>('/consultations/mine', { page: 1, limit: 20, ...query })
}

export async function fetchConsultationTeachers(): Promise<ConsultationTeacher[]> {
  const { data } = await api.get<ConsultationTeacher[]>('/consultations/teachers')
  return data
}

export async function fetchTeacherSlots(teacherId: string): Promise<ConsultationSlot[]> {
  const { data } = await api.get<ConsultationSlot[]>('/consultations/slots', {
    params: { teacherId },
  })
  return data
}

export async function createSlotRequest(input: CreateSlotInput): Promise<ConsultationSlot> {
  const { data } = await api.post<ConsultationSlot>('/consultations/slots', input)
  return data
}

export async function deleteSlotRequest(id: string): Promise<void> {
  await api.delete(`/consultations/slots/${id}`)
}

export async function bookSlotRequest(id: string, input: BookSlotInput): Promise<ConsultationSlot> {
  const { data } = await api.post<ConsultationSlot>(`/consultations/slots/${id}/book`, input)
  return data
}

export async function cancelSlotRequest(id: string): Promise<ConsultationSlot> {
  const { data } = await api.post<ConsultationSlot>(`/consultations/slots/${id}/cancel`)
  return data
}
