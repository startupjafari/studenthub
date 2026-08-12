import type { AttendanceStatus } from '../../../entities/attendance'

export const ATTENDANCE_ORDER: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']

// Badge-вариант статуса посещаемости (см. shared/ui/badge).
export const ATT_BADGE: Record<AttendanceStatus, 'success' | 'warning' | 'destructive' | 'info'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'destructive',
  EXCUSED: 'info',
}

// Классы активной кнопки-переключателя в ростере.
export const ATT_ACTIVE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-success/15 text-success ring-1 ring-success/40',
  LATE: 'bg-warning/15 text-warning-foreground dark:text-warning ring-1 ring-warning/40',
  ABSENT: 'bg-destructive/10 text-destructive ring-1 ring-destructive/40',
  EXCUSED: 'bg-info/10 text-info ring-1 ring-info/40',
}

// i18n-ключи (namespace Attendance): полная подпись и краткая (для кнопок ростера).
export const ATT_KEY: Record<AttendanceStatus, string> = {
  PRESENT: 'status.present',
  LATE: 'status.late',
  ABSENT: 'status.absent',
  EXCUSED: 'status.excused',
}

export const ATT_SHORT_KEY: Record<AttendanceStatus, string> = {
  PRESENT: 'short.present',
  LATE: 'short.late',
  ABSENT: 'short.absent',
  EXCUSED: 'short.excused',
}
