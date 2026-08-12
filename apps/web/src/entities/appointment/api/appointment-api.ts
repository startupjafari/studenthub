import type {
  ConfirmAppointmentInput,
  CreateAppointmentInput,
  AppointmentListQueryInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { Appointment } from '../model/types'

export const appointmentKeys = {
  all: ['deanery-appointments'] as const,
  mine: () => ['deanery-appointments', 'mine'] as const,
  queue: (filters: Partial<AppointmentListQueryInput> = {}) =>
    ['deanery-appointments', 'queue', filters] as const,
}

export async function fetchMyAppointments(): Promise<Appointment[]> {
  const { data } = await api.get<Appointment[]>('/deanery-appointments/mine')
  return data
}

export async function fetchAppointmentQueue(
  filters: Partial<AppointmentListQueryInput> = {},
): Promise<Appointment[]> {
  const { data } = await api.get<Appointment[]>('/deanery-appointments/queue', { params: filters })
  return data
}

export async function createAppointmentRequest(
  input: CreateAppointmentInput,
): Promise<Appointment> {
  const { data } = await api.post<Appointment>('/deanery-appointments', input)
  return data
}

export async function cancelAppointmentRequest(id: string): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`/deanery-appointments/${id}/cancel`)
  return data
}

export async function confirmAppointmentRequest(
  id: string,
  input: ConfirmAppointmentInput,
): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`/deanery-appointments/${id}/confirm`, input)
  return data
}

export async function rescheduleAppointmentRequest(
  id: string,
  input: ConfirmAppointmentInput,
): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`/deanery-appointments/${id}/reschedule`, input)
  return data
}

export async function completeAppointmentRequest(id: string): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`/deanery-appointments/${id}/complete`)
  return data
}

export async function staffCancelAppointmentRequest(id: string): Promise<Appointment> {
  const { data } = await api.post<Appointment>(`/deanery-appointments/${id}/staff-cancel`)
  return data
}
