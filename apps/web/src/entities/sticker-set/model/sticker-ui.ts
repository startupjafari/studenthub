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
