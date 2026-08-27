'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Check, ImagePlus, VideoIcon } from 'lucide-react'
import {
  attachVideoCover,
  profileContentKeys,
  uploadProfileMediaAuto,
} from '../../../entities/profile-content'
import { Button, FormAlert, ImageCropModal } from '../../../shared/ui'
import { useFormAlert } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ContentModal } from './content-modal'
import { VideoCoverPicker, type VideoCover } from './video-cover-picker'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

interface CreateModalProps {
  userId: string
  onClose: () => void
}

// Красивая зона загрузки: крупная иконка в мягком «чипе», подсказка и поддержка drag & drop.
function Dropzone({
  icon,
  hint,
  onPick,
  accept,
}: {
  icon: ReactNode
  hint: string
  onPick: (file: File) => void
  accept: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onPick(f)
        }}
        className={cn(
          'group flex min-h-48 w-full flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition-colors',
          over
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/40',
        )}
      >
        <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-105 motion-reduce:transform-none">
          {icon}
        </span>
        <span className="text-sm font-medium text-muted-foreground">{hint}</span>
      </button>
    </>
  )
}

// ── Фото: загрузка → кадрирование (обрезка/масштаб/поворот) → публикация ───────
export function PhotoCreateModal({ userId, onClose }: CreateModalProps) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)

  const mut = useMutation({
    mutationFn: (f: File) => uploadProfileMediaAuto(f),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileContentKeys.media(userId) })
      toast.success(t('mediaUploaded'))
      onClose()
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  if (file) {
    return (
      <ImageCropModal
        file={file}
        shape="square"
        title={t('uploadPhoto')}
        confirmLabel={t('publish')}
        saving={mut.isPending}
        onCancel={() => setFile(null)}
        onSave={(f) => mut.mutate(f)}
      />
    )
  }

  return (
    <ContentModal title={t('uploadPhoto')} onClose={onClose} size="upload">
      <Dropzone
        accept="image/*"
        icon={<ImagePlus className="size-8" aria-hidden />}
        hint={t('dropImageHint')}
        onPick={setFile}
      />
      <Button type="button" variant="outline" className="w-full" onClick={onClose}>
        {t('cancel')}
      </Button>
    </ContentModal>
  )
}

// ── Видео: загрузка + раскадровка (выбор обложки) → публикация ─────────────────
export function VideoCreateModal({ userId, onClose }: CreateModalProps) {
  const t = useTranslations('Profile')
  const qc = useQueryClient()
  const { error: apiError, show: showApiError, reset: resetApiError } = useFormAlert()
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [cover, setCover] = useState<VideoCover | null>(null)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  // Локальный предпросмотр выбранной обложки (poster у <video>).
  useEffect(() => {
    if (!cover) {
      setPosterUrl(null)
      return
    }
    const u = URL.createObjectURL(cover.blob)
    setPosterUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [cover])

  const mut = useMutation({
    mutationFn: async (f: File) => {
      const media = await uploadProfileMediaAuto(f)
      // Прикрепляем выбранную обложку (если есть) — отдельным запросом.
      if (cover) {
        const posterFile = new File([cover.blob], 'poster.jpg', { type: 'image/jpeg' })
        await attachVideoCover(media.id, posterFile).catch(() => {})
      }
      return media
    },
    onMutate: () => resetApiError(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileContentKeys.media(userId) })
      toast.success(t('mediaUploaded'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  return (
    <ContentModal title={t('uploadVideo')} onClose={onClose} size="upload">
      <FormAlert error={apiError} />
      {file && url ? (
        <>
          <video
            src={url}
            controls
            poster={posterUrl ?? undefined}
            className="min-h-0 w-full flex-1 rounded-xl bg-black object-contain"
          />
          <VideoCoverPicker file={file} onCover={setCover} />
        </>
      ) : (
        <Dropzone
          accept="video/*"
          icon={<VideoIcon className="size-8" aria-hidden />}
          hint={t('dropVideoHint')}
          onPick={setFile}
        />
      )}
      <div className="flex items-center gap-2">
        {file && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              setFile(null)
              setCover(null)
            }}
            disabled={mut.isPending}
          >
            {t('back')}
          </Button>
        )}
        <Button
          type="button"
          className="flex-1"
          loading={mut.isPending}
          disabled={!file}
          onClick={() => file && mut.mutate(file)}
        >
          <Check className="size-4" aria-hidden />
          {t('publish')}
        </Button>
      </div>
    </ContentModal>
  )
}
