'use client'

import dynamic from 'next/dynamic'
import { closeStickerEditor, useStickerUi } from '../../../entities/sticker-set'

// Редактор — отдельным чанком (FRONTEND_RULES §11): в окне чата он нужен редко.
const StickerEditor = dynamic(() => import('./sticker-editor').then((m) => m.StickerEditor), {
  ssr: false,
})

/**
 * Редактор стикера, открытый откуда угодно (панель стикеров, меню сообщения, просмотрщик,
 * «Мои наборы»): состояние — в entities/sticker-set, рисуется здесь один раз на окно чата.
 * Ключ по исходнику — новый исходник открывает редактор с чистого листа.
 */
export function StickerEditorHost() {
  const { editor } = useStickerUi()
  if (!editor) return null
  const key =
    editor.source.kind === 'file'
      ? `f:${editor.source.file.name}:${editor.source.file.size}:${editor.source.file.lastModified}`
      : `a:${editor.source.fileId}`
  return (
    <StickerEditor
      key={key}
      source={editor.source}
      initialSetId={editor.setId}
      onClose={closeStickerEditor}
    />
  )
}
