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

export const EXAM_FORMATS: string[] = ['ORAL', 'WRITTEN', 'TEST', 'PROJECT', 'OTHER']

export function formatKey(format: string): string {
  return `format.${format.toLowerCase()}`
}
