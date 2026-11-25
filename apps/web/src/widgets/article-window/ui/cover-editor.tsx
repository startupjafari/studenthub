'use client'

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Palette, RefreshCw, Trash2 } from 'lucide-react'
import {
  ARTICLE_GRADIENTS,
  ArticleCover,
  uploadArticleCover,
} from '../../../entities/profile-content'
import { ImageCropModal, Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui'
import { maxUploadBytes, toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

export interface CoverValue {
  coverUrl: string
  coverGradient: string
}

/**
 * Обложка статьи — необязательная, как в Medium: пока её нет, над заголовком лишь тихие
 * кнопки «Обложка» и «Градиент», а не пустой блок на треть экрана. Снимок сначала
 * кадрируется в 16:9 (так его покажут и читалка, и карточки), потом загружается.
 */
export function CoverEditor({
  value,
  title,
  onChange,
}: {
  value: CoverValue
  title: string
  onChange: (next: CoverValue) => void
}) {
  const t = useTranslations('Article')
  const tErr = useTranslations('Errors')
  const inputRef = useRef<HTMLInputElement>(null)
  const [cropping, setCropping] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: uploadArticleCover,
    onSuccess: (r) => {
      onChange({ coverUrl: r.url, coverGradient: '' })
      setCropping(null)
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  function pick(file: File | undefined): void {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('coverImageOnly'))
      return
    }
    if (file.size > maxUploadBytes(file.type)) {
      toast.error(tErr('FILE_TOO_LARGE'))
      return
    }
    setCropping(file)
  }

  const hasCover = Boolean(value.coverUrl || value.coverGradient)

  const gradientPicker = (trigger: React.ReactNode) => (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="grid w-64 grid-cols-6 gap-2 p-3">
        {ARTICLE_GRADIENTS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-label={t('gradientOption', { n: g.key.slice(1) })}
            aria-pressed={value.coverGradient === g.key}
            onClick={() => onChange({ coverUrl: '', coverGradient: g.key })}
            className={cn(
              'aspect-square cursor-pointer rounded-md ring-2 ring-offset-2 ring-offset-popover transition-shadow focus-visible:outline-none focus-visible:ring-ring',
              g.className,
              value.coverGradient === g.key ? 'ring-primary' : 'ring-transparent',
            )}
          />
        ))}
      </PopoverContent>
    </Popover>
  )

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {hasCover ? (
        <div className="group relative">
          <ArticleCover
            coverUrl={value.coverUrl || null}
            coverGradient={value.coverGradient || null}
            title={title}
            bare
            className="aspect-[16/9] w-full rounded-2xl object-cover"
          />
          <div className="absolute top-3 right-3 flex gap-1.5 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
            <CoverAction label={t('coverReplace')} onClick={() => inputRef.current?.click()}>
              <RefreshCw className="size-4" aria-hidden />
            </CoverAction>
            {gradientPicker(
              <button
                type="button"
                aria-label={t('coverGradient')}
                title={t('coverGradient')}
                className={COVER_ACTION}
              >
                <Palette className="size-4" aria-hidden />
              </button>,
            )}
            <CoverAction
              label={t('coverRemove')}
              onClick={() => onChange({ coverUrl: '', coverGradient: '' })}
            >
              <Trash2 className="size-4" aria-hidden />
            </CoverAction>
          </div>
          {upload.isPending && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 text-white">
              <Loader2 className="size-6 animate-spin" aria-hidden />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className={GHOST}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              pick(e.dataTransfer.files?.[0])
            }}
          >
            {upload.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="size-4" aria-hidden />
            )}
            {t('coverAdd')}
          </button>
          {gradientPicker(
            <button type="button" className={GHOST}>
              <Palette className="size-4" aria-hidden />
              {t('coverGradient')}
            </button>,
          )}
        </div>
      )}

      {cropping && (
        <ImageCropModal
          file={cropping}
          saving={upload.isPending}
          shape="square"
          aspect={16 / 9}
          outputWidth={1600}
          title={t('coverCropTitle')}
          confirmLabel={t('coverApply')}
          onCancel={() => setCropping(null)}
          onSave={(cropped) => upload.mutate(cropped)}
        />
      )}
    </>
  )
}

const GHOST =
  'flex h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50'

const COVER_ACTION =
  'flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none'

function CoverAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={COVER_ACTION}
    >
      {children}
    </button>
  )
}
