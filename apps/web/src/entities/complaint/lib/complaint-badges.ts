import { complaintPriorityFor } from '@studenthub/shared-schemas'
import type { Complaint, ComplaintPriorityValue, ComplaintStatusValue } from '../model/types'

// Цвета статуса и приоритета — один источник для очереди, модалки разбора и дашборда
// модератора. Лежит в entity, а не в слайсе экрана: слайсы друг у друга не импортируют.
// Приоритет — статусный цвет + текст (правило рельефа: не только цветом, §2).
export const STATUS_STYLE: Record<ComplaintStatusValue, string> = {
  PENDING: 'bg-warning/15 text-warning',
  REVIEWING: 'bg-primary/10 text-primary',
  RESOLVED: 'bg-success/15 text-success',
  DISMISSED: 'bg-muted text-muted-foreground',
}

export const PRIORITY_STYLE: Record<ComplaintPriorityValue, string> = {
  HIGH: 'bg-destructive/15 text-destructive',
  MEDIUM: 'bg-warning/15 text-warning',
  LOW: 'bg-muted text-muted-foreground',
}

/**
 * Приоритет жалобы для отображения: значение сервера, а если его нет — то же правило по
 * категории цели (`complaintPriorityFor`). Без фолбэка строка показывала бы
 * «priorityundefined» на любом ответе без поля.
 */
export function complaintPriority(
  complaint: Pick<Complaint, 'priority' | 'targetType'>,
): ComplaintPriorityValue {
  return complaint.priority ?? complaintPriorityFor(complaint.targetType)
}
