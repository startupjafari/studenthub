import { z } from 'zod'

// Расписание (docs/PROJECT.md §3.1, §6; docs/BACKEND_RULES.md §19 #8).
// Значения enum дублируют Prisma-enum WeekType/ScheduleChangeType (единый контракт API↔форма,
// без зависимости shared-schemas от @prisma/client). Сервис маппит их 1-в-1 на Prisma-enum.

export const WeekTypeSchema = z.enum(['ODD', 'EVEN', 'BOTH'])
export type WeekTypeValue = z.infer<typeof WeekTypeSchema>

export const ScheduleChangeTypeSchema = z.enum([
  'MOVED',
  'ROOM_CHANGED',
  'CANCELLED',
  'SUBSTITUTED',
])
export type ScheduleChangeTypeValue = z.infer<typeof ScheduleChangeTypeSchema>

// Настенное время в таймзоне вуза, "HH:mm" 24ч. Календарной даты у пары нет (еженедельный повтор).
export const TimeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате HH:mm (00:00–23:59)')

// День недели по ISO-8601: 1 = понедельник … 7 = воскресенье.
export const DayOfWeekSchema = z.number().int().min(1).max(7)

// Календарная дата "YYYY-MM-DD" (в календаре вуза) — только для разовых изменений.
export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате YYYY-MM-DD')

// ── Контейнер расписания (Schedule) ─────────────────────────────────────────

export const CreateScheduleSchema = z
  .object({
    groupId: z.string().min(1),
    name: z.string().min(1).max(150),
    isActive: z.boolean().optional(),
  })
  .strict()
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>

export const UpdateScheduleSchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>

// ── Пара (Pair) ─────────────────────────────────────────────────────────────

const pairShape = {
  scheduleId: z.string().min(1),
  subject: z.string().min(1).max(200),
  teacherId: z.string().min(1).nullable().optional(),
  roomId: z.string().min(1).nullable().optional(),
  dayOfWeek: DayOfWeekSchema,
  startTime: TimeStringSchema,
  endTime: TimeStringSchema,
  weekType: WeekTypeSchema.optional(),
}

// startTime строго меньше endTime (строки "HH:mm" сравнимы лексикографически).
const endAfterStart = (v: { startTime: string; endTime: string }, ctx: z.RefinementCtx): void => {
  if (v.startTime >= v.endTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Время начала должно быть раньше времени окончания',
      path: ['endTime'],
    })
  }
}

export const CreatePairSchema = z.object(pairShape).strict().superRefine(endAfterStart)
export type CreatePairInput = z.infer<typeof CreatePairSchema>

// Обновление пары: любое подмножество полей, кроме scheduleId (пару не переносят между контейнерами).
export const UpdatePairSchema = z
  .object({
    subject: pairShape.subject.optional(),
    teacherId: pairShape.teacherId,
    roomId: pairShape.roomId,
    dayOfWeek: DayOfWeekSchema.optional(),
    startTime: TimeStringSchema.optional(),
    endTime: TimeStringSchema.optional(),
    weekType: WeekTypeSchema.optional(),
  })
  .strict()
export type UpdatePairInput = z.infer<typeof UpdatePairSchema>

// ── Ролевая выборка расписания (read) ────────────────────────────────────────
// Фильтры (docs/PROJECT.md §3.1): группа, преподаватель, аудитория, день, чётность, предмет.
// Роль ограничивает выборку в сервисе (студент → своя группа и т.д.); фильтры сужают внутри scope.
export const ScheduleQuerySchema = z
  .object({
    groupId: z.string().min(1).optional(),
    teacherId: z.string().min(1).optional(),
    roomId: z.string().min(1).optional(),
    dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
    weekType: WeekTypeSchema.optional(),
    subject: z.string().min(1).max(200).optional(),
  })
  .strict()
export type ScheduleQueryInput = z.infer<typeof ScheduleQuerySchema>

// Список контейнеров расписания (для управления).
export const ScheduleListQuerySchema = z
  .object({
    groupId: z.string().min(1).optional(),
  })
  .strict()
export type ScheduleListQueryInput = z.infer<typeof ScheduleListQuerySchema>

// ── Разовое изменение (ScheduleChange) ───────────────────────────────────────

export const CreateScheduleChangeSchema = z
  .object({
    pairId: z.string().min(1),
    type: ScheduleChangeTypeSchema,
    date: DateStringSchema,
    newRoomId: z.string().min(1).nullable().optional(),
    newTeacherId: z.string().min(1).nullable().optional(),
    newStartTime: TimeStringSchema.optional(),
    newEndTime: TimeStringSchema.optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Обязательные поля по типу изменения (docs/PROJECT.md §3.1).
    if (v.type === 'ROOM_CHANGED' && !v.newRoomId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Нужна новая аудитория',
        path: ['newRoomId'],
      })
    }
    if (v.type === 'SUBSTITUTED' && !v.newTeacherId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Нужен заменяющий преподаватель',
        path: ['newTeacherId'],
      })
    }
    if (v.type === 'MOVED') {
      if (!v.newStartTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Нужно новое время начала',
          path: ['newStartTime'],
        })
      }
      if (!v.newEndTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Нужно новое время окончания',
          path: ['newEndTime'],
        })
      }
      if (v.newStartTime && v.newEndTime && v.newStartTime >= v.newEndTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Начало должно быть раньше окончания',
          path: ['newEndTime'],
        })
      }
    }
  })
export type CreateScheduleChangeInput = z.infer<typeof CreateScheduleChangeSchema>

// Список изменений за период [from, to] (для наложения на сетку недели).
export const ScheduleChangeQuerySchema = z
  .object({
    from: DateStringSchema,
    to: DateStringSchema,
    groupId: z.string().min(1).optional(),
    teacherId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from > v.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from должно быть не позже to',
        path: ['to'],
      })
    }
  })
export type ScheduleChangeQueryInput = z.infer<typeof ScheduleChangeQuerySchema>
