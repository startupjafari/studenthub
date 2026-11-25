'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadToBucket } from '../../../shared/api'
import { localId, maxUploadBytes, toApiError } from '../../../shared/lib'
import {
  moveItem,
  pickAcceptable,
  readyMediaIds,
  type ComposerMedia,
  type RejectReason,
} from './media-queue'

export interface MediaUploads {
  items: ComposerMedia[]
  /** Добавить файлы; отказы (тип, размер, лимит) — в колбэк, по одному на причину. */
  add: (files: readonly File[]) => void
  remove: (key: string) => void
  retry: (key: string) => void
  move: (from: number, to: number) => void
  /** Освободить превью и забыть всё — после публикации. */
  clear: () => void
  uploading: boolean
  failed: boolean
  readyIds: string[]
}

/**
 * Вложения поста: каждый файл грузится сам по себе, со своим прогрессом, отменой и
 * повтором. Раньше файлы шли строго по очереди под одним общим спиннером: ошибка одного
 * молча выбрасывала его из списка, а отменить долгую загрузку видео было нельзя.
 */
export function useMediaUploads(onReject: (reasons: Set<RejectReason>) => void): MediaUploads {
  const [items, setItems] = useState<ComposerMedia[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  // Актуальный список для колбэков, которым незачем пересоздаваться на каждый прогресс.
  const itemsRef = useRef(items)
  itemsRef.current = items

  const patch = useCallback((key: string, edit: Partial<ComposerMedia>) => {
    setItems((prev) => prev.map((m) => (m.key === key ? { ...m, ...edit } : m)))
  }, [])

  const start = useCallback(
    (key: string, file: File) => {
      const controller = new AbortController()
      controllers.current.set(key, controller)
      uploadToBucket('POSTS', file, (progress) => patch(key, { progress }), controller.signal)
        .then((uploaded) => patch(key, { status: 'done', progress: 100, fileId: uploaded.id }))
        .catch((e: unknown) => {
          // Отменённую загрузку строка уже покинула — сообщать не о чем.
          if (controller.signal.aborted) return
          patch(key, { status: 'error', errorCode: toApiError(e).code })
        })
        .finally(() => {
          if (controllers.current.get(key) === controller) controllers.current.delete(key)
        })
    },
    [patch],
  )

  const add = useCallback(
    (files: readonly File[]) => {
      const { accepted, rejected } = pickAcceptable(files, itemsRef.current.length, maxUploadBytes)
      if (rejected.size > 0) onReject(rejected)
      if (accepted.length === 0) return
      const fresh: ComposerMedia[] = accepted.map((file) => ({
        key: localId('media'),
        file,
        previewUrl: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
        status: 'uploading',
        progress: 0,
      }))
      setItems((prev) => [...prev, ...fresh])
      fresh.forEach((m) => start(m.key, m.file))
    },
    [onReject, start],
  )

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort()
    controllers.current.delete(key)
    setItems((prev) => {
      const gone = prev.find((m) => m.key === key)
      if (gone) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((m) => m.key !== key)
    })
  }, [])

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((m) => m.key === key)
      if (!item || item.status !== 'error') return
      patch(key, { status: 'uploading', progress: 0, errorCode: undefined })
      start(key, item.file)
    },
    [patch, start],
  )

  const move = useCallback((from: number, to: number) => {
    setItems((prev) => moveItem(prev, from, to))
  }, [])

  const clear = useCallback(() => {
    controllers.current.forEach((c) => c.abort())
    controllers.current.clear()
    itemsRef.current.forEach((m) => URL.revokeObjectURL(m.previewUrl))
    setItems([])
  }, [])

  // Окно закрыли посреди загрузки — обрываем её и отпускаем превью.
  useEffect(
    () => () => {
      controllers.current.forEach((c) => c.abort())
      itemsRef.current.forEach((m) => URL.revokeObjectURL(m.previewUrl))
    },
    [],
  )

  return {
    items,
    add,
    remove,
    retry,
    move,
    clear,
    uploading: items.some((m) => m.status === 'uploading'),
    failed: items.some((m) => m.status === 'error'),
    readyIds: readyMediaIds(items),
  }
}
