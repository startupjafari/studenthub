import type {
  AssignmentType,
  SubmissionTypeValue,
  UpdateAssignmentInput,
} from '@studenthub/shared-schemas'
import type { AssignmentItem } from '../../../entities/assignment'

// Значения формы задания (создание и правка): строки полей ввода, как их держит модалка.
export interface AssignmentFormValues {
  title: string
  description: string
  type: AssignmentType
  submissionType: SubmissionTypeValue
  // Пустая строка — без максимума.
  maxScore: string
  // Значение DateTimePicker «YYYY-MM-DDTHH:mm» в локальном времени; пустое — без срока.
  dueAtLocal: string
  allowLate: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** ISO из API → значение DateTimePicker в локальном времени. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function assignmentFormDefaults(a: AssignmentItem): AssignmentFormValues {
  return {
    title: a.title,
    description: a.description ?? '',
    type: a.type as AssignmentType,
    submissionType: a.submissionType as SubmissionTypeValue,
    maxScore: a.maxScore != null ? String(a.maxScore) : '',
    dueAtLocal: toLocalInput(a.dueAt),
    allowLate: a.allowLate,
  }
}

/**
 * Тело PATCH /assignments/:id — только изменённые поля. Срок сравнивается по минутам
 * пикера, а не по ISO: иначе открытие и сохранение без правок «меняло» бы срок на секунды,
 * и в аудит опубликованного задания попадала бы правка, которой не было.
 */
export function buildAssignmentPatch(
  a: AssignmentItem,
  values: AssignmentFormValues,
): UpdateAssignmentInput {
  const before = assignmentFormDefaults(a)
  const patch: UpdateAssignmentInput = {}
  const title = values.title.trim()
  if (title !== before.title) patch.title = title
  const description = values.description.trim()
  if (description !== before.description.trim()) patch.description = description || null
  if (values.type !== before.type) patch.type = values.type
  if (values.submissionType !== before.submissionType) patch.submissionType = values.submissionType
  if (values.maxScore.trim() !== before.maxScore) {
    patch.maxScore = values.maxScore.trim() ? Number(values.maxScore) : null
  }
  if (values.dueAtLocal !== before.dueAtLocal) {
    patch.dueAt = values.dueAtLocal ? new Date(values.dueAtLocal).toISOString() : null
  }
  if (values.allowLate !== before.allowLate) patch.allowLate = values.allowLate
  return patch
}
