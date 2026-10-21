import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Камеры вуза (docs/PROJECT.md §3.10): агенты в сети вуза, камеры за ними и выключатель
// модуля. Смотрят камеры только охрана и админ вуза; управляет админ вуза.

/** Состояние камеры по отчёту агента. Зеркало enum CameraStatus в Prisma. */
export const CAMERA_STATUSES = ['UNKNOWN', 'ONLINE', 'OFFLINE', 'AUTH_FAILED'] as const
export const CameraStatusSchema = z.enum(CAMERA_STATUSES)
export type CameraStatusValue = z.infer<typeof CameraStatusSchema>

const nameField = z.string().trim().min(1).max(100)

// rtsp(s)://<authority><путь>. Authority — хост, необязательный порт, IPv6 в скобках. Разбор
// регулярным выражением, а не через `URL`: пакет собирается без DOM- и Node-типов, а
// поведение `URL` с нестандартными схемами в браузерах и Node расходится.
const RTSP_URL = /^rtsps?:\/\/([^/?#]*)([/?#].*)?$/i
const RTSP_AUTHORITY = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i

/**
 * Адрес потока камеры в сети вуза: `rtsp://10.0.0.5:554/Streaming/Channels/102`.
 *
 * Логин и пароль в адресе запрещены: адрес хранится открытым текстом, а учётные данные —
 * отдельно и зашифрованными ключом агента. `rtsp://admin:pass@…` в этом поле положил бы
 * пароль камеры в базу как есть.
 */
export const CameraStreamUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((value, ctx) => {
    const match = RTSP_URL.exec(value)
    if (!match) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Адрес должен начинаться с rtsp://' })
      return
    }
    const authority = match[1] ?? ''
    if (authority.includes('@')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Логин и пароль укажите в отдельных полях, а не в адресе',
      })
      return
    }
    if (!RTSP_AUTHORITY.test(authority)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'В адресе нет хоста камеры' })
    }
  })

/** Учётные данные камеры. Уходят на сервер один раз и сразу шифруются ключом агента. */
export const CameraCredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
  })
  .strict()
export type CameraCredentialsInput = z.infer<typeof CameraCredentialsSchema>

export const CreateCameraAgentSchema = z.object({ name: nameField }).strict()
export type CreateCameraAgentInput = z.infer<typeof CreateCameraAgentSchema>

export const UpdateCameraAgentSchema = z.object({ name: nameField }).strict()
export type UpdateCameraAgentInput = z.infer<typeof UpdateCameraAgentSchema>

export const CreateCameraSchema = z
  .object({
    agentId: z.string().min(1),
    name: nameField,
    streamUrl: CameraStreamUrlSchema,
    roomId: z.string().min(1).nullable().optional(),
    credentials: CameraCredentialsSchema.optional(),
  })
  .strict()
export type CreateCameraInput = z.infer<typeof CreateCameraSchema>

/**
 * Правка камеры. `credentials: null` — убрать учётные данные (камера без пароля),
 * отсутствие поля — оставить как есть: прежний пароль клиенту не возвращается, и форма
 * не может прислать его обратно.
 */
export const UpdateCameraSchema = z
  .object({
    name: nameField.optional(),
    streamUrl: CameraStreamUrlSchema.optional(),
    roomId: z.string().min(1).nullable().optional(),
    enabled: z.boolean().optional(),
    credentials: CameraCredentialsSchema.nullable().optional(),
  })
  .strict()
export type UpdateCameraInput = z.infer<typeof UpdateCameraSchema>

export const CameraListQuerySchema = OffsetPaginationSchema.extend({
  agentId: z.string().min(1).optional(),
})
export type CameraListQueryInput = z.infer<typeof CameraListQuerySchema>

/** Выключатель модуля камер вуза: выключение обрывает все просмотры разом. */
export const UpdateCameraSettingsSchema = z.object({ enabled: z.boolean() }).strict()
export type UpdateCameraSettingsInput = z.infer<typeof UpdateCameraSettingsSchema>
