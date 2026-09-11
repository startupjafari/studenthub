'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { File as FileIcon, Play, X } from 'lucide-react'
import { Button, Checkbox, Modal, ScrollRow } from '../../../shared/ui'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isMedia(f: File): boolean {
  return f.type.startsWith('image/') || f.type.startsWith('video/')
}

/** Локальное превью выбранного файла: object-URL создаём и освобождаем на месте. */
function useObjectUrl(file: File, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, enabled])
  return url
}

// Крупная плитка фото или видео в сетке превью.
function MediaTile({
  file,
  onRemove,
  removeLabel,
}: {
  file: File
  onRemove: () => void
  removeLabel: string
}) {
  const url = useObjectUrl(file, true)
  const isVideo = file.type.startsWith('video/')
  return (
    <div className="group relative size-28 shrink-0 overflow-hidden rounded-lg bg-muted">
      {url &&
        (isVideo ? (
          <video src={url} muted className="size-full object-cover" />
        ) : (
          <img src={url} alt="" className="size-full object-cover" />
        ))}
      {isVideo && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white">
            <Play className="size-4 translate-x-px" aria-hidden />
          </span>
        </span>
      )}
      {/* Крестик на самой плитке, а не в строке рядом: снимок узнают в лицо, и убирать его
          логично оттуда же, куда смотрят. Всегда виден на тач-экране, по наведению — на ПК. */}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="absolute right-1 top-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[0.65rem] text-white/90">
        {humanSize(file.size)}
      </span>
    </div>
  )
}

// Строка обычного файла: иконка, имя, размер, крестик.
function FileRow({
  file,
  onRemove,
  removeLabel,
}: {
  file: File
  onRemove: () => void
  removeLabel: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border p-2">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className="block text-xs text-muted-foreground">{humanSize(file.size)}</span>
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/**
 * Диалог отправки файлов (Telegram-стиль §9): что именно уходит, подпись и действия.
 *
 * Фото и видео показываются плитками-превью, а не строками файлового менеджера: перед
 * отправкой проверяют «тот ли это снимок», и ответ даёт сама картинка, а не её имя вида
 * `image_2026-08-19_11-23-48.png`. Документы остаются строками — у них узнаваемо как раз имя.
 */
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
  onSend: (caption: string, spoiler: boolean) => void
  onAddMore: () => void
  onRemove: (index: number) => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const [caption, setCaption] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  // Индексы сохраняем: onRemove работает по позиции в исходном списке, а мы его делим надвое.
  const indexed = files.map((file, index) => ({ file, index }))
  const media = indexed.filter((f) => isMedia(f.file))
  const docs = indexed.filter((f) => !isMedia(f.file))
  const removeLabel = t('removeAttachment')

  return (
    <Modal
      onClose={onClose}
      // Заголовок называет, что именно уходит: «Отправить как файл» над тремя снимками
      // обещало не то, что произойдёт.
      title={
        docs.length === 0
          ? t('sendPhotosTitle', { count: media.length })
          : t('sendFilesTitle', { count: files.length })
      }
      size="lg"
    >
      <div className="flex flex-col gap-3">
        {/* Снимки — одним рядом с прокруткой вбок, а не сеткой в несколько строк: десять
            выбранных фото уводили подпись и кнопки за нижний край окна, и до «Отправить»
            приходилось долистывать. Ряд держит высоту окна постоянной, сколько бы файлов
            ни выбрали. Прокрутка — общий ScrollRow: колесо, перетаскивание мышью,
            затухание у краёв. */}
        {media.length > 0 && (
          <ScrollRow className="gap-2 py-0.5">
            {media.map(({ file, index }) => (
              <MediaTile
                key={`${file.name}-${index}`}
                file={file}
                removeLabel={removeLabel}
                onRemove={() => onRemove(index)}
              />
            ))}
          </ScrollRow>
        )}
        {docs.length > 0 && (
          <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {docs.map(({ file, index }) => (
              <FileRow
                key={`${file.name}-${index}`}
                file={file}
                removeLabel={removeLabel}
                onRemove={() => onRemove(index)}
              />
            ))}
          </div>
        )}

        <input
          autoFocus
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && files.length > 0 && !sending) {
              e.preventDefault()
              onSend(caption, spoiler)
            }
          }}
          placeholder={t('captionPlaceholder')}
          className="h-10 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
        />

        {/* Спойлер (§34) имеет смысл только для фото и видео. */}
        {media.length > 0 && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={spoiler} onCheckedChange={(v) => setSpoiler(v === true)} />
            {t('spoilerToggle')}
          </label>
        )}

        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={onAddMore}>
            {t('addMore')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              loading={sending}
              disabled={files.length === 0}
              onClick={() => onSend(caption, spoiler)}
            >
              {t('send')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
