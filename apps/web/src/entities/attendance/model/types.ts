import type { AttendanceStatus } from '@studenthub/shared-schemas'
export type { AttendanceStatus }

export interface RosterEntry {
  studentId: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  status: AttendanceStatus | null
  note: string | null
}

export interface AttendanceRoster {
  pairId: string
  date: string
  subject: string
  students: RosterEntry[]
}

export interface AttendanceRecord {
  id: string
  date: string
  status: AttendanceStatus
  note: string | null
  pair: { subject: string; startTime: string }
}

export interface AttendanceSummary {
  total: number
  present: number
  late: number
  absent: number
  excused: number
  rate: number
  records: AttendanceRecord[]
}

// QR-посещаемость (задача 6): токен занятия для преподавателя.
export interface AttendanceQrToken {
  token: string
  qr: string // data:image/png dataURL
  checkinUrl: string
  subject: string
  date: string
  expiresAt: string
  ttlSeconds: number
}

// Результат самоотметки студента по QR.
export interface CheckInResult {
  status: AttendanceStatus
  subject: string
  date: string
  already: boolean
}
