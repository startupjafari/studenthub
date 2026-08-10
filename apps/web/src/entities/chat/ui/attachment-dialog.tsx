'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { File as FileIcon, X } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { useBodyScrollLock } from '../../../shared/lib'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Миниатюра выбранного файла в диалоге отправки (#4): для изображений — превью через
// object-URL (создаём/освобождаем), иначе — иконка файла.
function AttachmentThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  if (url) {
    // Локальное превью выбранного изображения — обычный img по object-URL.
    return <img src={url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <FileIcon className="size-5" aria-hidden />
    </span>
  )
}

// Диалог отправки файлов в стиле Telegram (Ф9+): превью выбранных файлов + подпись + действия.
export function AttachmentDialog({
  files,
  sending,
  onSend,
  onAddMore,
  onRemove,
  onClose,
}: {
  files: File[]
  sending: boolean
  onSend: (caption: string) => void
  onAddMore: () => void
  onRemove: (index: number) => void
  onClose: () => void
}) {
  useBodyScrollLock()
  const t = useTranslations('Chats')
  const [caption, setCaption] = useState('')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{t('sendAsFile')}</span>
          <button
            type="button"
            aria-label={t('cancel')}
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-2.5 rounded-xl border border-border p-2"
            >
              <AttachmentThumb file={f} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="block text-xs text-muted-foreground">{humanSize(f.size)}</span>
              </span>
              <button
                type="button"
                aria-label={t('removeAttachment')}
                onClick={() => onRemove(i)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>

        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && files.length > 0 && !sending) {
              e.preventDefault()
              onSend(caption)
            }
          }}
          placeholder={t('captionPlaceholder')}
          className="h-10 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        />

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={onAddMore}>
            {t('addMore')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={sending}
              disabled={files.length === 0}
              onClick={() => onSend(caption)}
            >
              {t('send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
