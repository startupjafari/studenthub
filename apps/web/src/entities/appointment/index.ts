export {
  appointmentKeys,
  fetchMyAppointments,
  fetchAppointmentQueue,
  createAppointmentRequest,
  cancelAppointmentRequest,
  confirmAppointmentRequest,
  rescheduleAppointmentRequest,
  completeAppointmentRequest,
  staffCancelAppointmentRequest,
} from './api/appointment-api'
export type { Appointment, AppointmentStatus, AppointmentType } from './model/types'
