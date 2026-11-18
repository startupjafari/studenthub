'use client'

import { useSyncExternalStore } from 'react'
import type { StickerSetPreviewQuery } from '../api/user-stickers-api'

// Окна своих стикеров открываются из разных мест — панель стикеров поля ввода, меню
// сообщения, просмотрщик медиа, пузырь стикера, «Мои наборы», — а рисуются по одному разу
// в окне чата (хосты из features). Состояние — здесь, в сущности: фичи не импортируют друг
// друга (FRONTEND_RULES §2.1), а открыть редактор из «Моих наборов» нужно.
//
// Простое внешнее хранилище, а не контекст: панель стикеров живёт в поповере, и после её
// закрытия редактор не должен размонтироваться вместе с ней.

/** Откуда делаем стикер: файл с устройства или вложение переписки. */
export type StickerSource =
  | { kind: 'file'; file: File }
  | {
      kind: 'attachment'
      fileId: string
      mime: string
      width?: number | null
      height?: number | null
      durationMs?: number | null
    }

interface StickerUiState {
  editor: { source: StickerSource; setId?: string } | null
  preview: StickerSetPreviewQuery | null
  manage: boolean
}

let state: StickerUiState = { editor: null, preview: null, manage: false }
const listeners = new Set<() => void>()

function set(next: Partial<StickerUiState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const SERVER_STATE: StickerUiState = { editor: null, preview: null, manage: false }

/** Текущее состояние окон своих стикеров. */
export function useStickerUi(): StickerUiState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  )
}

/** Открыть редактор стикера. `setId` — сразу предложить этот набор при сохранении. */
export function openStickerEditor(source: StickerSource, setId?: string): void {
  set({ editor: { source, setId } })
}

export function closeStickerEditor(): void {
  set({ editor: null })
}

/** Что принимаем исходником стикера с устройства: картинки, GIF и короткое видео. */
export const STICKER_SOURCE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime'

/**
 * Выбрать файл (или снять камерой) и открыть с ним редактор. Поле выбора файла — вне дерева
 * React: кнопка живёт в поповере панели стикеров, и закрытие поповера иначе уносило бы поле
 * вместе с ещё не пришедшим `change`.
 */
export function pickStickerSource(opts: { camera?: boolean; setId?: string } = {}): void {
  if (typeof document === 'undefined') return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = opts.camera ? 'image/*' : STICKER_SOURCE_ACCEPT
  // Фронтальная камера — как у «сделать стикер» в Telegram; на ПК атрибут игнорируется.
  if (opts.camera) input.setAttribute('capture', 'user')
  input.addEventListener(
    'change',
    () => {
      const file = input.files?.[0]
      if (file) openStickerEditor({ kind: 'file', file }, opts.setId)
    },
    { once: true },
  )
  input.click()
}

/** Окно набора: по ссылке (slug) или по стикеру из переписки (id набора). */
export function openStickerSetPreview(query: StickerSetPreviewQuery): void {
  set({ preview: query })
}

export function closeStickerSetPreview(): void {
  set({ preview: null })
}

export function openMyStickerSets(): void {
  set({ manage: true })
}

export function closeMyStickerSets(): void {
  set({ manage: false })
}

/** Исходник стикера из вложения сообщения. */
export function attachmentStickerSource(att: {
  id: string
  mime: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
}): StickerSource {
  return {
    kind: 'attachment',
    fileId: att.id,
    mime: att.mime,
    width: att.width,
    height: att.height,
    durationMs: att.durationMs,
  }
}

/** Из каких вложений можно сделать стикер: картинки, GIF и видео (не кружок, не документ). */
export function canMakeSticker(att: {
  mime: string
  asDocument?: boolean
  videoNote?: boolean
  uploading?: boolean
  id: string
}): boolean {
  if (att.uploading || att.id.startsWith('tmp') || att.asDocument || att.videoNote) return false
  return att.mime.startsWith('image/') || att.mime.startsWith('video/')
}
