import type { ExamFormat } from '@studenthub/shared-schemas'
import type { ExamResultStatus } from '../../../entities/exam'

export const EXAM_STATUS_ORDER: ExamResultStatus[] = [
  'SCHEDULED',
  'PASSED',
  'FAILED',
  'ABSENT',
  'RETAKE',
]

export const EXAM_STATUS_BADGE: Record<
  ExamResultStatus,
  'secondary' | 'success' | 'destructive' | 'warning' | 'info'
> = {
  SCHEDULED: 'secondary',
  PASSED: 'success',
  FAILED: 'destructive',
  ABSENT: 'warning',
  RETAKE: 'info',
}

export const EXAM_STATUS_KEY: Record<ExamResultStatus, string> = {
  SCHEDULED: 'status.scheduled',
  PASSED: 'status.passed',
  FAILED: 'status.failed',
  ABSENT: 'status.absent',
  RETAKE: 'status.retake',
}

/**
 * Подписи форматов экзамена.
 *
 * Явная карта, а не собранный ключ `format.${f.toLowerCase()}`: такого ключа в словарях
 * не было вовсе, и на трёх экранах — список деканата, список студента, выпадающий
 * список в модалке — печаталось сырое «Exams.format.written». Построенный ключ не видят
 * ни компилятор, ни тест словарей (FRONTEND_RULES §10). Список форматов берём из
 * shared-schemas — там он SSOT, локальная копия жила отдельной жизнью.
 */
export const EXAM_FORMAT_KEY: Record<ExamFormat, string> = {
  ORAL: 'formatLabel.oral',
  WRITTEN: 'formatLabel.written',
  TEST: 'formatLabel.test',
  PROJECT: 'formatLabel.project',
  OTHER: 'formatLabel.other',
}

/** Формат с сервера приходит строкой — неизвестное значение показываем как «Другое». */
export function examFormatKey(format: string): string {
  return EXAM_FORMAT_KEY[format as ExamFormat] ?? EXAM_FORMAT_KEY.OTHER
}
