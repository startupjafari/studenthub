'use client'

import { useEffect, useState } from 'react'
import { MediaViewer } from '../../../shared/ui'
import { isViewableMedia } from '../lib/file-open'

export interface ViewableFile {
  id: string
  mime: string
  name?: string | null
}

interface Props {
  files: ViewableFile[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  /**
   * Резолвер ссылки: `download` различает просмотр и скачивание (просмотрщик всегда просит
   * просмотр). Разный у владельца (`/documents/:id/files/:fileId/url`) и у платформенного
   * спец-доступа — поэтому приходит снаружи, а не строится здесь.
   */
  resolveUrl: (fileId: string, download: boolean) => Promise<string>
}

/**
 * Просмотр файлов документа в том же полноэкранном просмотрщике, что в чате и постах.
 *
 * Ссылки presigned и живут 15 минут, поэтому резолвятся лениво — только для открытой
 * страницы, а не для всего списка сразу, и заново при переключении.
 *
 * Ссылка на страницу — одна, на просмотр: каждая выдача пишется в журнал документа, и
 * прежняя пара «просмотр + скачивание» на каждое открытие давала две записи, из которых
 * одна — ложное скачивание. Кнопка «Скачать» просмотрщика сохраняет уже открытый файл.
 */
export function DocumentFileViewer({ files, index, onIndexChange, onClose, resolveUrl }: Props) {
  const [src, setSrc] = useState<string>()
  const current = files[index]

  useEffect(() => {
    if (!current) return
    let alive = true
    setSrc(undefined)
    void resolveUrl(current.id, false).then(
      (view) => {
        // Пока грузилась ссылка, могли переключить файл или закрыть окно — не перетираем.
        if (alive) setSrc(view)
      },
      () => {
        if (alive) onClose()
      },
    )
    return () => {
      alive = false
    }
    // resolveUrl приходит из замыкания вызывающего и меняется на каждый рендер —
    // в зависимостях его быть не должно, иначе ссылки перезапрашивались бы бесконечно.
  }, [current?.id])

  if (!current || !isViewableMedia(current.mime)) return null

  return (
    <MediaViewer
      items={files.map((f) => ({ mime: f.mime, name: f.name ?? null }))}
      index={index}
      src={src}
      downloadName={current.name ?? null}
      onIndexChange={onIndexChange}
      onClose={onClose}
    />
  )
}
