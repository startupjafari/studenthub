import { z } from 'zod'
import { REACTION_EMOJI_MAX, isSingleEmoji } from './chats.js'
import { vm } from './validation-messages.js'

// Свои стикеры (docs/PROJECT.md «Свои стикеры»): любой пользователь собирает личные наборы
// прямо в приложении, делится ими ссылкой, другие добавляют набор себе. Каталог платформы
// (STICKER_LIMITS, /admin/sticker-sets) живёт рядом и не меняется.

/**
 * Лимиты личных наборов.
 *
 * - `SETS_PER_USER` — 10 своих наборов: студенту хватит с запасом (в Telegram у типичного
 *   автора 1–3 набора), а хранилище от одного человека ограничено ≈ 10 × 120 × 512 КБ = 600 МБ
 *   в худшем случае (обычный WebP-стикер — 30–80 КБ, то есть ≈ 50–100 МБ).
 * - `STICKERS_PER_SET` — 120, как у статичных наборов Telegram: набор листается в панели
 *   без пагинации.
 * - `ADDED_SETS_MAX` — 50 добавленных наборов (своих и чужих): панель отдаёт их одним
 *   ответом, 50 × 120 подписанных ссылок — потолок, который ещё укладывается в разумный
 *   размер ответа.
 * - Формат стикера — как в Telegram: WebP, большая сторона 512 px, ≤ 512 КБ; анимация —
 *   ≤ 3 с, ≤ 30 кадров/с, без звука. Подгоняет сервер, пользователь о форматах не думает.
 * - `SOURCE_MAX_BYTES` — исходник с устройства до 10 МБ (порог буферной загрузки API).
 *   Длинное видео из переписки берётся по `sourceFileId` без повторной загрузки.
 */
export const USER_STICKER_LIMITS = {
  SETS_PER_USER: 10,
  STICKERS_PER_SET: 120,
  ADDED_SETS_MAX: 50,
  TITLE_MAX: 64,
  SIDE_PX: 512,
  MAX_BYTES: 512 * 1024,
  ANIMATION_MAX_MS: 3000,
  ANIMATION_MIN_MS: 300,
  ANIMATION_MAX_FPS: 30,
  SOURCE_MAX_BYTES: 10 * 1024 * 1024,
} as const

const title = z.string().trim().min(1).max(USER_STICKER_LIMITS.TITLE_MAX)
const entityId = z.string().min(1).max(100)

/** Новый личный набор (`POST /chats/stickers/mine`): одно поле — название. */
export const UserStickerSetCreateSchema = z.object({ title }).strict()
export type UserStickerSetCreateInput = z.infer<typeof UserStickerSetCreateSchema>

/** Переименовать свой набор (`PATCH /chats/stickers/mine/:setId`). */
export const UserStickerSetUpdateSchema = z.object({ title }).strict()
export type UserStickerSetUpdateInput = z.infer<typeof UserStickerSetUpdateSchema>

/**
 * Новый порядок стикеров набора (`PUT /chats/stickers/mine/:setId/order`): все живые стикеры
 * набора ровно по разу. Неполный список — 422: молча дописывать пропущенные значило бы
 * переставить не то, что человек видел на экране.
 */
export const UserStickerReorderSchema = z
  .object({
    stickerIds: z
      .array(entityId)
      .min(1)
      .max(USER_STICKER_LIMITS.STICKERS_PER_SET)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: vm('validation.common.duplicateIds'),
      }),
  })
  .strict()
export type UserStickerReorderInput = z.infer<typeof UserStickerReorderSchema>

/** Число из текстового поля multipart: пустая строка — «не задано». */
const formNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().finite().min(min).max(max).optional(),
  )

/**
 * Текстовые поля multipart `POST /chats/stickers/mine/:setId/stickers` (кроме файлов).
 *
 * Источник — файл в поле `file` ИЛИ `sourceFileId` (вложение переписки, которое видит автор:
 * «Сделать стикером» из меню сообщения — без повторной загрузки ролика).
 *
 * Для анимации (GIF, видео) сервер сам режет отрезок `startMs`/`durationMs` (≤ 3 с), кадрирует
 * по `crop*` (доли кадра 0…1) и кладёт поверх прозрачный PNG из поля `overlay` (надпись,
 * нарисованная клиентом в размер итогового стикера). Статичную картинку клиент присылает уже
 * готовой (обрезка, обводка, надпись — на устройстве); сервер приводит её к WebP 512 px.
 */
export const UserStickerUploadFieldsSchema = z
  .object({
    emoji: z
      .string()
      .max(REACTION_EMOJI_MAX)
      .refine(isSingleEmoji, vm('validation.chats.reactionEmoji'))
      .optional(),
    sourceFileId: entityId.optional(),
    startMs: formNumber(0, 24 * 60 * 60 * 1000),
    durationMs: formNumber(
      USER_STICKER_LIMITS.ANIMATION_MIN_MS,
      USER_STICKER_LIMITS.ANIMATION_MAX_MS,
    ),
    cropX: formNumber(0, 1),
    cropY: formNumber(0, 1),
    cropW: formNumber(0.01, 1),
    cropH: formNumber(0.01, 1),
  })
  .strict()
  .refine(
    (v) => {
      const set = [v.cropX, v.cropY, v.cropW, v.cropH].filter((n) => n !== undefined).length
      if (set !== 0 && set !== 4) return false
      if (set === 0) return true
      return v.cropX! + v.cropW! <= 1.0001 && v.cropY! + v.cropH! <= 1.0001
    },
    { path: ['cropX'] },
  )
export type UserStickerUploadFieldsInput = z.infer<typeof UserStickerUploadFieldsSchema>

/**
 * Превью набора (`GET /chats/stickers/preview`): по короткому имени из ссылки
 * `/addstickers/<slug>` или по id набора (нажатие на стикер в переписке). Ровно одно из двух.
 */
export const StickerSetPreviewQuerySchema = z
  .object({
    slug: z.string().trim().min(1).max(64).optional(),
    setId: entityId.optional(),
  })
  .strict()
  .refine((v) => (v.slug === undefined) !== (v.setId === undefined), { path: ['slug'] })
export type StickerSetPreviewQuery = z.infer<typeof StickerSetPreviewQuerySchema>
