import type { BookSlotInput, CreateSlotInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ConsultationSlot, ConsultationTeacher } from '../model/types'

export const consultationKeys = {
  all: ['consultations'] as const,
  mine: () => ['consultations', 'mine'] as const,
  teachers: () => ['consultations', 'teachers'] as const,
  teacherSlots: (teacherId: string) => ['consultations', 'slots', teacherId] as const,
}

export async function fetchMyConsultations(): Promise<ConsultationSlot[]> {
  const { data } = await api.get<ConsultationSlot[]>('/consultations/mine')
  return data
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
