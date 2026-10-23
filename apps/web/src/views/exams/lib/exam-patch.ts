import type { ExamFormat, UpdateExamInput } from '@studenthub/shared-schemas'
import type { ExamItem } from '../../../entities/exam'

/** Поля формы экзамена, которые можно поменять после назначения. */
export interface ExamFormValues {
  /** Локальное время для DateTimePicker: `YYYY-MM-DDTHH:mm`. */
  dateLocal: string
  format: ExamFormat
  maxScore: string
  roomId: string | null
  /** `undefined` — экзаменатора в форме нет (преподаватель не выбирает): поле не трогаем. */
  examinerId?: string | null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** ISO → значение DateTimePicker в локальном часовом поясе. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function examFormDefaults(exam: ExamItem): ExamFormValues {
  return {
    dateLocal: toLocalInput(exam.date),
    format: exam.format as ExamFormat,
    maxScore: exam.maxScore != null ? String(exam.maxScore) : '',
    roomId: exam.room?.id ?? null,
    examinerId: exam.examiner?.id ?? null,
  }
}

/**
 * Тело `PATCH /exams/:id` — только изменённые поля. Перенос и смена аудитории уходят
 * группе уведомлением, а пересечения сервер проверяет лишь по тому, что меняется: лишнее
 * поле в теле означало бы ложный «перенос» и отказ из-за чужого экзамена.
 */
export function buildExamPatch(exam: ExamItem, form: ExamFormValues): UpdateExamInput {
  const patch: UpdateExamInput = {}
  if (form.dateLocal && form.dateLocal !== toLocalInput(exam.date)) {
    patch.date = new Date(form.dateLocal).toISOString()
  }
  if (form.format !== exam.format) patch.format = form.format
  const maxScore = form.maxScore.trim() ? Number(form.maxScore) : null
  if (maxScore !== exam.maxScore) patch.maxScore = maxScore
  if (form.roomId !== (exam.room?.id ?? null)) patch.roomId = form.roomId
  if (form.examinerId !== undefined && form.examinerId !== (exam.examiner?.id ?? null)) {
    patch.examinerId = form.examinerId
  }
  return patch
}
