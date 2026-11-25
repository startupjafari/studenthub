import { z } from 'zod'
import { vm } from './validation-messages.js'

// Группы как в Telegram (docs/PROJECT.md §8.3): разрешения участников, вступление по ссылке,
// заявки и история фото. Одна логика прав на сервер (проверка отправки) и клиентов
// (композер прячет запрещённое) — иначе интерфейс и сервер расходятся в мелочах.

/**
 * Права рядового участника пользовательской группы — экран «Разрешения» Telegram.
 *
 * - `sendMessages` — писать вообще (текст, геопозиция, контакт). Выключено — выключено всё
 *   остальное из отправки: Telegram держит именно такую зависимость.
 * - `sendMedia` — фото, видео, файлы, голосовые и кружки.
 * - `embedLinks` — сообщения со ссылками.
 * - `sendPolls` — опросы и чек-листы.
 * - `addMembers` — добавлять людей в группу.
 * - `pinMessages` — закреплять и откреплять сообщения.
 * - `changeInfo` — менять название и описание (фото группы остаётся за владельцем, §8.3).
 *
 * Админов и владельца ограничения не касаются.
 */
export const CHAT_PERMISSION_KEYS = [
  'sendMessages',
  'sendMedia',
  'embedLinks',
  'sendPolls',
  'addMembers',
  'pinMessages',
  'changeInfo',
] as const
export type ChatPermissionKey = (typeof CHAT_PERMISSION_KEYS)[number]

export const ChatPermissionsSchema = z
  .object({
    sendMessages: z.boolean(),
    sendMedia: z.boolean(),
    embedLinks: z.boolean(),
    sendPolls: z.boolean(),
    addMembers: z.boolean(),
    pinMessages: z.boolean(),
    changeInfo: z.boolean(),
  })
  .strict()
export type ChatPermissions = z.infer<typeof ChatPermissionsSchema>

/**
 * Права по умолчанию — ровно то, что участники могли до появления экрана: писать что угодно
 * и закреплять; добавлять людей и менять название — только админы.
 */
export const DEFAULT_CHAT_PERMISSIONS: ChatPermissions = {
  sendMessages: true,
  sendMedia: true,
  embedLinks: true,
  sendPolls: true,
  addMembers: false,
  pinMessages: true,
  changeInfo: false,
}

/** Права, которые зависят от `sendMessages`: без права писать нельзя и их. */
const SEND_DEPENDENT: readonly ChatPermissionKey[] = ['sendMedia', 'embedLinks', 'sendPolls']

/**
 * Права группы из хранимого значения (`Chat.permissions`, Json): поверх умолчаний, лишнее и
 * неверного типа отбрасывается, зависимость от `sendMessages` применяется. Читать хранимое
 * как есть нельзя — строка из старой версии или ручная правка базы иначе ломала бы отправку.
 */
export function resolveChatPermissions(raw: unknown): ChatPermissions {
  const out = storedChatPermissions(raw)
  if (!out.sendMessages) for (const key of SEND_DEPENDENT) out[key] = false
  return out
}

/**
 * Выбор админа как есть — поверх умолчаний, но БЕЗ зависимости от `sendMessages`. Его и
 * хранит сервер: выключили «писать» и включили обратно — медиа, ссылки и прочее вернутся
 * такими, какими их оставили, а не выключенными навсегда.
 */
export function storedChatPermissions(raw: unknown): ChatPermissions {
  const out: ChatPermissions = { ...DEFAULT_CHAT_PERMISSIONS }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    for (const key of CHAT_PERMISSION_KEYS) {
      const value = record[key]
      if (typeof value === 'boolean') out[key] = value
    }
  }
  return out
}

/** `PATCH /chats/:id/permissions`: любые из прав, хотя бы одно. */
export const UpdateChatPermissionsSchema = ChatPermissionsSchema.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: vm('validation.common.nothingToChange'),
  })
export type UpdateChatPermissionsInput = z.infer<typeof UpdateChatPermissionsSchema>

/**
 * `PATCH /chats/:id/join-settings` — тип группы.
 *
 * `joinByLink: false` — «закрытая» группа: ссылки-приглашения нет, людей добавляют админы.
 * `joinByLink: true` — «по ссылке»: вступает любой, у кого есть ссылка (свой вуз и прочие
 * правила добавления в группу остаются). `joinApproval` — вступление по ссылке через заявку.
 * Публичных групп с поиском по всей платформе нет намеренно: платформа закрытая, а группа
 * в поиске вне своего вуза раскрывала бы чужим состав и переписку.
 */
export const ChatJoinSettingsSchema = z
  .object({
    joinByLink: z.boolean().optional(),
    joinApproval: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.joinByLink !== undefined || v.joinApproval !== undefined, {
    message: vm('validation.common.nothingToChange'),
  })
export type ChatJoinSettingsInput = z.infer<typeof ChatJoinSettingsSchema>

/** Что несёт отправка — по этому решается, какие права нужны (messagePermissionNeeds). */
export interface ChatSendContent {
  /** Текст или подпись: ссылка в нём требует `embedLinks`. */
  text?: string | null
  /** Вложения: фото, видео, файлы, голосовые. */
  media?: boolean
  /** Опрос или чек-лист. */
  poll?: boolean
}

/**
 * Права, которые нужны для отправки. `sendMessages` нужен всегда — Telegram устроен так же:
 * без права писать нельзя прислать и медиа.
 */
export function messagePermissionNeeds(content: ChatSendContent): ChatPermissionKey[] {
  const needs: ChatPermissionKey[] = ['sendMessages']
  if (content.media) needs.push('sendMedia')
  if (content.poll) needs.push('sendPolls')
  if (containsLink(content.text)) needs.push('embedLinks')
  return needs
}

/**
 * Есть ли в тексте ссылка (право `embedLinks`). Считаются http(s) и `www.` — то, что клиенты
 * делают кликабельным; голое «example.com» ссылкой не становится и не запрещается.
 */
export function containsLink(text: string | null | undefined): boolean {
  return !!text && /(?:https?:\/\/|\bwww\.)[^\s<>"']/i.test(text)
}

/**
 * Первое право из `needs`, которого у участника нет, или null — можно. `privileged` — админ
 * или владелец группы: ограничения их не касаются.
 */
export function missingChatPermission(
  permissions: ChatPermissions,
  needs: readonly ChatPermissionKey[],
  privileged: boolean,
): ChatPermissionKey | null {
  if (privileged) return null
  return needs.find((key) => !permissions[key]) ?? null
}

/** Фото из истории аватаров (`GET /users/:id/avatars`, `GET /chats/:id/avatars`). */
export interface AvatarPhotoDto {
  id: string
  url: string
  createdAt: string
  /** Текущий аватар — первый в списке. */
  current: boolean
}
