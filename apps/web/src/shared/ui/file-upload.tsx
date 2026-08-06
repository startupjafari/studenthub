'use client'

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Upload, X, FileText, RotateCcw, CheckCircle2 } from 'lucide-react'
import { FILE_UPLOAD, type FileCategory } from '@studenthub/shared-config'
import { cn } from '../lib/utils'
import { Button } from './button'

export interface FileUploadProps<T> {
  /** Категория задаёт лимит размера и белый список типов. */
  category: FileCategory
  /** Функция загрузки — инкапсулирует эндпоинт/бакет (напр. аватар vs медиа поста). */
  uploadFn: (file: File, onProgress: (percent: number) => void) => Promise<T>
  /** Успешная загрузка — родитель привязывает результат к своей сущности. */
  onUploaded: (result: T) => void
  /** Ошибка загрузки (код) — для внешней обработки при необходимости. */
  onError?: (code: string) => void
  className?: string
  disabled?: boolean
}

type Status = 'idle' | 'ready' | 'uploading' | 'error' | 'done'

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

// Клиентская проверка размера/типа ДО отправки (docs/FRONTEND_RULES.md §7.6).
// Серверная проверка по magic bytes при этом не отменяется.
export function FileUpload<T>({
  category,
  uploadFn,
  onUploaded,
  onError,
  className,
  disabled = false,
}: FileUploadProps<T>) {
  const t = useTranslations('FileUpload')
  const tErr = useTranslations('Errors')
  const inputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const allowedMimes = FILE_UPLOAD.ALLOWED_MIME[category] as readonly string[]
  const categoryMax = FILE_UPLOAD.MAX_BYTES[category]
  const bufferMax = FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES

  // Освобождаем object URL превью при замене/размонтировании.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    setProgress(0)
    setError(null)
    setStatus('idle')
    if (inputRef.current) inputRef.current.value = ''
  }

  function selectFile(picked: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)

    if (!allowedMimes.includes(picked.type)) {
      setError(t('invalidType'))
      setStatus('error')
      setFile(null)
      setPreviewUrl(null)
      return
    }
    if (picked.size > categoryMax) {
      setError(t('fileTooLarge', { max: formatMb(categoryMax) }))
      setStatus('error')
      setFile(null)
      setPreviewUrl(null)
      return
    }
    // Файлы ≤ лимита категории, но больше порога буфера, требуют прямой presigned-загрузки —
    // эндпоинт пока не реализован на бэкенде (Ф2, отложено).
    if (picked.size > bufferMax) {
      setError(t('directUploadUnavailable', { max: formatMb(bufferMax) }))
      setStatus('error')
      setFile(null)
      setPreviewUrl(null)
      return
    }

    setError(null)
    setProgress(0)
    setFile(picked)
    setPreviewUrl(category === 'IMAGE' ? URL.createObjectURL(picked) : null)
    setStatus('ready')
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (picked) selectFile(picked)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const picked = e.dataTransfer.files?.[0]
    if (picked) selectFile(picked)
  }

  async function upload() {
    if (!file) return
    setStatus('uploading')
    setProgress(0)
    setError(null)
    try {
      const result = await uploadFn(file, setProgress)
      setStatus('done')
      onUploaded(result)
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'INTERNAL_ERROR'
      setError(tErr(code))
      setStatus('error')
      onError?.(code)
    }
  }

  const isImage = category === 'IMAGE'

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={allowedMimes.join(',')}
        className="sr-only"
        onChange={onInputChange}
        disabled={disabled || status === 'uploading'}
      />

      {/* Пустое состояние: зона выбора/перетаскивания. */}
      {(status === 'idle' || status === 'error') && !file && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            'border-input text-muted-foreground hover:border-ring hover:text-foreground',
            dragOver && 'border-ring bg-accent',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          <Upload className="size-6" aria-hidden />
          <span className="text-sm font-medium">{t('dropHint')}</span>
          <span className="text-xs">{t('limitHint', { max: formatMb(bufferMax) })}</span>
        </button>
      )}

      {/* Выбранный файл: превью + метаданные + действия. */}
      {file && (
        <div className="flex items-center gap-3 rounded-lg border border-input p-3">
          {isImage && previewUrl ? (
            <Image
              src={previewUrl}
              alt={t('previewAlt')}
              width={56}
              height={56}
              unoptimized
              className="size-14 shrink-0 rounded object-cover"
            />
          ) : (
            <FileText className="size-8 shrink-0 text-muted-foreground" aria-hidden />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatMb(file.size)}</p>

            {status === 'uploading' && (
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {status === 'done' && (
              <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                <CheckCircle2 className="size-3.5" aria-hidden />
                {t('done')}
              </p>
            )}
          </div>

          {status !== 'uploading' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('remove')}
              onClick={reset}
            >
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      )}

      {/* Ошибка + повтор. */}
      {status === 'error' && error && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-destructive">{error}</p>
          {file && (
            <Button type="button" variant="outline" size="sm" onClick={upload}>
              <RotateCcw className="size-4" aria-hidden />
              {t('retry')}
            </Button>
          )}
        </div>
      )}

      {/* Кнопка загрузки для готового к отправке файла. */}
      {(status === 'ready' || status === 'uploading') && (
        <Button type="button" onClick={upload} disabled={disabled} loading={status === 'uploading'}>
          <Upload className="size-4" aria-hidden />
          {t('upload')}
        </Button>
      )}
    </div>
  )
}
