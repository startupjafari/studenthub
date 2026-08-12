import { z } from 'zod'

// Посещаемость (docs/ACADEMIC_CORE.md, задача 5). Статус — строка (SSOT здесь).
export const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const
export const AttendanceStatusSchema = z.enum(ATTENDANCE_STATUSES)
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// Ростер занятия: пара + дата → список студентов с текущими отметками.
export const AttendanceRosterQuerySchema = z
  .object({
    pairId: z.string().min(1),
    date: ymd,
  })
  .strict()
export type AttendanceRosterQueryInput = z.infer<typeof AttendanceRosterQuerySchema>

// Массовая простановка/обновление отметок занятия (преподаватель).
export const MarkAttendanceSchema = z
  .object({
    pairId: z.string().min(1),
    date: ymd,
    entries: z
      .array(
        z
          .object({
            studentId: z.string().min(1),
            status: AttendanceStatusSchema,
            note: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
export type MarkAttendanceInput = z.infer<typeof MarkAttendanceSchema>

// QR-посещаемость (задача 6). Преподаватель генерирует QR для занятия (пара+дата);
// студент сканирует камерой → открывает /checkin?t=… → самоотметка PRESENT/LATE.
export const QrTokenQuerySchema = z
  .object({
    pairId: z.string().min(1),
    date: ymd,
  })
  .strict()
export type QrTokenQueryInput = z.infer<typeof QrTokenQuerySchema>

export const QrCheckInSchema = z
  .object({
    token: z.string().min(1).max(2000),
  })
  .strict()
export type QrCheckInInput = z.infer<typeof QrCheckInSchema>

// Сводка студента (опциональный диапазон дат).
export const AttendanceSummaryQuerySchema = z
  .object({
    from: ymd.optional(),
    to: ymd.optional(),
  })
  .strict()
export type AttendanceSummaryQueryInput = z.infer<typeof AttendanceSummaryQuerySchema>
