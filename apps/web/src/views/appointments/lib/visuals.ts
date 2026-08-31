import type { AppointmentStatus, AppointmentType } from '../../../entities/appointment'

export const APPT_STATUS_BADGE: Record<
  AppointmentStatus,
  'secondary' | 'success' | 'info' | 'outline' | 'destructive'
> = {
  REQUESTED: 'secondary',
  CONFIRMED: 'success',
  RESCHEDULED: 'info',
  COMPLETED: 'outline',
  CANCELLED: 'destructive',
}

export const APPT_STATUS_KEY: Record<AppointmentStatus, string> = {
  REQUESTED: 'status.requested',
  CONFIRMED: 'status.confirmed',
  RESCHEDULED: 'status.rescheduled',
  COMPLETED: 'status.completed',
  CANCELLED: 'status.cancelled',
}

/**
 * Подписи типов записи.
 *
 * Явная карта, а не собранный ключ `type.${type.toLowerCase()}`. Построенный ключ не
 * видит ни компилятор, ни тест словарей — и все четыре подписи молча печатались сырым
 * «Appointments.type.other» сразу на трёх экранах (FRONTEND_RULES §10). С `Record` по
 * union'у новый тип записи не собрать, пока для него нет подписи.
 */
export const APPT_TYPE_KEY: Record<AppointmentType, string> = {
  CONSULTATION: 'typeLabel.consultation',
  DOCUMENT: 'typeLabel.document',
  ACADEMIC: 'typeLabel.academic',
  OTHER: 'typeLabel.other',
}

/** Тип с сервера приходит строкой — неизвестное значение показываем как «Другое». */
export function apptTypeKey(type: string): string {
  return APPT_TYPE_KEY[type as AppointmentType] ?? APPT_TYPE_KEY.OTHER
}
