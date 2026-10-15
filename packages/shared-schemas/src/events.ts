import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'
import { PostAudienceSchema } from './posts.js'

// События (docs/PROJECT.md §3.5, Ф10). Аудитория — тот же enum, что у постов (видимость по аналогии).

/**
 * Провайдер онлайн-встречи. Закрытый список: по нему рисуется подпись и иконка, а
 * «любая другая ссылка» — это OTHER, а не повод завести ещё одно значение на месте.
 */
export const MEETING_PROVIDERS = ['ZOOM', 'GOOGLE_MEET', 'TEAMS', 'OTHER'] as const
export const MeetingProviderSchema = z.enum(MEETING_PROVIDERS)
export type MeetingProviderValue = z.infer<typeof MeetingProviderSchema>

/**
 * Ссылка на встречу: только http/https и только абсолютная.
 *
 * Схема живёт здесь, а не в модуле api: её же проверяет форма события в вебе, и вторая
 * копия правила разошлась бы с первой. Протокол ограничен по той же причине, что и у
 * сторис: ссылка уходит в кнопку «Присоединиться», а `javascript:` в кнопке — это XSS.
 */
export const MeetingUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((url) => /^https?:\/\//i.test(url), { message: 'Ссылка должна быть http или https' })

/**
 * Провайдер по хосту ссылки. Определяет СЕРВЕР при сохранении: если бы значение
 * присылал клиент, «Zoom» в карточке означал бы лишь то, что так написал организатор.
 * Неизвестный хост — OTHER: своя встреча в Jitsi или вузовском сервисе тоже встреча.
 */
export function meetingProviderOf(url: string): MeetingProviderValue {
  // Хост берётся регулярным выражением, а не `new URL`: пакет собирается без DOM- и
  // node-типов (он общий для браузера и сервера), и глобального URL в нём попросту нет.
  // Отбрасываем userinfo (`user@host`) и порт — иначе `zoom.us:443` стал бы «другим».
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim())
  if (!match?.[1]) return 'OTHER'
  const host = match[1]
    .toLowerCase()
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '')
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'ZOOM'
  if (host === 'meet.google.com') return 'GOOGLE_MEET'
  if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return 'TEAMS'
  return 'OTHER'
}

const eventBase = {
  audience: PostAudienceSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  location: z.string().max(300).optional(),
  isOnline: z.boolean().optional(),
  // Ссылка на встречу и код доступа — у онлайн-события. Провайдера клиент не присылает:
  // его ставит сервер по хосту (meetingProviderOf).
  meetingUrl: MeetingUrlSchema.optional(),
  meetingPasscode: z.string().trim().max(64).optional(),
  // ISO-8601 с таймзоной. Клиент присылает абсолютный момент; хранение — UTC.
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  facultyId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
}

const endAfterStart = (v: { startsAt: string; endsAt?: string }, ctx: z.RefinementCtx): void => {
  if (v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Окончание должно быть позже начала',
      path: ['endsAt'],
    })
  }
}

export const CreateEventSchema = z.object(eventBase).strict().superRefine(endAfterStart)
export type CreateEventInput = z.infer<typeof CreateEventSchema>

export const UpdateEventSchema = z
  .object({
    title: eventBase.title.optional(),
    description: eventBase.description.optional(),
    location: z.string().max(300).nullable().optional(),
    isOnline: z.boolean().optional(),
    // null стирает встречу — так её и убирают, когда событие стало очным.
    meetingUrl: MeetingUrlSchema.nullable().optional(),
    meetingPasscode: z.string().trim().max(64).nullable().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .strict()
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>

// Список: ближайшие/прошедшие + только свои (организатор/участник) + пагинация.
export const EventListQuerySchema = OffsetPaginationSchema.extend({
  filter: z.enum(['upcoming', 'past']).default('upcoming'),
  mine: z.coerce.boolean().optional(),
})
export type EventListQueryInput = z.infer<typeof EventListQuerySchema>

/**
 * Ссылка на встречу для участника (`GET /events/:id/meeting`).
 *
 * Окно подключения отдаётся сервером, а не считается на клиенте: у события есть
 * таймзона вуза и собственное представление о том, когда «уже можно», и два ответа
 * на этот вопрос разошлись бы на переводе часов.
 */
export const EventMeetingSchema = z.object({
  provider: MeetingProviderSchema,
  url: z.string(),
  passcode: z.string().nullable(),
  joinableFrom: z.string(),
  joinableUntil: z.string(),
  joinable: z.boolean(),
})
export type EventMeeting = z.infer<typeof EventMeetingSchema>

// Комментарий к событию (§3.5): вопрос организатору, уточнение, обсуждение. Только текст.
export const CreateEventCommentSchema = z
  .object({ content: z.string().trim().min(1).max(2000) })
  .strict()
export type CreateEventCommentInput = z.infer<typeof CreateEventCommentSchema>
