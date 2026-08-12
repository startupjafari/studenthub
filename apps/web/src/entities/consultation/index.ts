export {
  consultationKeys,
  fetchMyConsultations,
  fetchConsultationTeachers,
  fetchTeacherSlots,
  createSlotRequest,
  deleteSlotRequest,
  bookSlotRequest,
  cancelSlotRequest,
} from './api/consultation-api'
export type { ConsultationSlot, ConsultationTeacher, ConsultationStatus } from './model/types'
