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

/**
 * Какие из перечисленных пар уже отмечены на дату. Нужен дашборду преподавателя:
 * пары на сегодня он уже получил из `/me/today`, и остаётся один вопрос — по каким
 * журнал заполнен. Список идентификаторов приходит от клиента, а не вычисляется на
 * сервере, чтобы не тянуть расписание с его чётностью и заменами во второй раз.
 */
export const AttendanceMarkedQuerySchema = z
  .object({
    date: ymd,
    // Запятыми: пар в дне единицы, повторять `?pairIds=` семь раз незачем.
    // Потолок на всякий случай — запрос не должен превращаться в выгрузку.
    pairIds: z
      .string()
      .min(1)
      .transform((v) => v.split(',').filter(Boolean))
      .pipe(z.array(z.string().min(1)).min(1).max(20)),
  })
  .strict()
export type AttendanceMarkedQueryInput = z.infer<typeof AttendanceMarkedQuerySchema>
