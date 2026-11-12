'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Sticker, Trash2, Upload, X } from 'lucide-react'
import { STICKER_LIMITS, StickerUploadFieldsSchema } from '@studenthub/shared-schemas'
import {
  deleteStickerRequest,
  deleteStickerSetRequest,
  STICKER_ACCEPT,
  stickerFileProblem,
  stickerSetKeys,
  updateStickerSetRequest,
  uploadStickerRequest,
  type AdminStickerSet,
} from '../../../entities/sticker-set'
import {
  Badge,
  Button,
  Card,
  CardContent,
  FieldError,
  Input,
  Label,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib/api-error'

interface Props {
  set: AdminStickerSet
  /** Можно ли поднять/опустить: первый набор выше не поднимается, последний — ниже. */
  canMoveUp: boolean
  canMoveDown: boolean
  /** Перенос идёт (несколько PATCH подряд) — стрелки всех наборов заблокированы. */
  moving: boolean
  onMove: (direction: -1 | 1) => void
  onRename: () => void
}

/**
 * Набор стикеров в админке: публикация, порядок, переименование, удаление, загрузка и
 * удаление стикеров. Ответ сервера на любое действие — набор целиком: кладём его в кэш списка.
 */
export function StickerSetCard({ set, canMoveUp, canMoveDown, moving, onMove, onRename }: Props) {
  const t = useTranslations('StickerAdmin')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [emoji, setEmoji] = useState('')
  const [emojiError, setEmojiError] = useState<string | null>(null)

  const replace = (updated: AdminStickerSet): void => {
    qc.setQueryData<AdminStickerSet[]>(stickerSetKeys.admin(), (old) =>
      old?.map((s) => (s.id === updated.id ? updated : s)),
    )
  }
  const onError = (e: unknown): void => {
    toast.error(tErr(toApiError(e).code))
  }

  const publish = useMutation({
    mutationFn: (isPublished: boolean) => updateStickerSetRequest(set.id, { isPublished }),
    onSuccess: (updated) => {
      replace(updated)
      toast.success(updated.isPublished ? t('publishedToast') : t('unpublishedToast'))
    },
    onError,
  })

  const removeSet = useMutation({
    mutationFn: () => deleteStickerSetRequest(set.id),
    onSuccess: () => {
      qc.setQueryData<AdminStickerSet[]>(stickerSetKeys.admin(), (old) =>
        old?.filter((s) => s.id !== set.id),
      )
      toast.success(t('deleted'))
    },
    onError,
  })

  const upload = useMutation({
    mutationFn: ({ file, emoji: value }: { file: File; emoji?: string }) =>
      uploadStickerRequest(set.id, file, value),
    onSuccess: (updated) => {
      replace(updated)
      setEmoji('')
      toast.success(t('uploaded'))
    },
    onError,
  })

  const removeSticker = useMutation({
    mutationFn: (stickerId: string) => deleteStickerRequest(set.id, stickerId),
    onSuccess: (updated) => {
      replace(updated)
      toast.success(t('stickerDeleted'))
    },
    onError,
  })

  async function onDeleteSet(): Promise<void> {
    const ok = await confirm({
      title: t('deleteConfirmTitle'),
      description: t('deleteConfirmDesc', { title: set.title }),
      confirmLabel: t('deleteConfirm'),
      destructive: true,
    })
    if (ok) removeSet.mutate()
  }

  // Эмодзи проверяем той же схемой, что сервер, — до выбора файла: иначе человек выбрал бы
  // картинку и только потом узнал, что подпись не годится.
  function pickFile(): void {
    const value = emoji.trim()
    const parsed = StickerUploadFieldsSchema.safeParse({ emoji: value || undefined })
    if (!parsed.success) {
      setEmojiError(t('emojiInvalid'))
      return
    }
    setEmojiError(null)
    fileRef.current?.click()
  }

  function onFile(file: File | undefined): void {
    if (!file) return
    const problem = stickerFileProblem(file)
    if (problem) {
      toast.error(problem === 'type' ? t('fileType') : t('fileSize'))
      return
    }
    upload.mutate({ file, emoji: emoji.trim() || undefined })
  }

  const full = set.stickers.length >= STICKER_LIMITS.STICKERS_PER_SET_MAX
  const emojiId = `sticker-emoji-${set.id}`

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{set.title}</h2>
              <Badge variant={set.isPublished ? 'success' : 'secondary'}>
                {set.isPublished ? t('published') : t('draft')}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {set.slug} · {t('stickerCount', { count: set.stickers.length })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('moveUp', { title: set.title })}
              disabled={!canMoveUp || moving}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('moveDown', { title: set.title })}
              disabled={!canMoveDown || moving}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('rename', { title: set.title })}
              onClick={onRename}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={t('delete', { title: set.title })}
              disabled={removeSet.isPending}
              onClick={() => void onDeleteSet()}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 aria-hidden />
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={publish.isPending}
              disabled={publish.isPending}
              onClick={() => publish.mutate(!set.isPublished)}
            >
              {set.isPublished ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {set.isPublished ? t('unpublish') : t('publish')}
            </Button>
          </div>
        </div>

        {set.stickers.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            <Sticker className="size-4 shrink-0" aria-hidden />
            {t('noStickers')}
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
            {set.stickers.map((sticker) => (
              <li
                key={sticker.id}
                className="relative flex aspect-square items-center justify-center rounded-lg bg-muted/40 p-1.5"
              >
                {/* Подписанная ссылка на приватный бакет: next/image её не оптимизирует. */}
                <img
                  src={sticker.url}
                  alt={
                    sticker.emoji ? t('stickerAlt', { emoji: sticker.emoji }) : t('stickerAltPlain')
                  }
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                />
                {sticker.emoji && (
                  <span className="absolute bottom-1 left-1 text-sm leading-none" aria-hidden>
                    {sticker.emoji}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t('deleteSticker')}
                  disabled={removeSticker.isPending}
                  onClick={() => removeSticker.mutate(sticker.id)}
                  className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border transition-colors hover:text-destructive disabled:cursor-default disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emojiId}>{t('emojiLabel')}</Label>
            <Input
              id={emojiId}
              size="sm"
              value={emoji}
              maxLength={16}
              aria-invalid={emojiError ? true : undefined}
              onChange={(e) => {
                setEmoji(e.target.value)
                setEmojiError(null)
              }}
              className="w-28"
            />
            <FieldError>{emojiError ?? undefined}</FieldError>
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={upload.isPending}
            disabled={upload.isPending || full}
            onClick={pickFile}
          >
            <Upload aria-hidden />
            {t('upload')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={STICKER_ACCEPT}
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              onFile(e.target.files?.[0])
              // Сбрасываем выбор: тот же файл можно выбрать снова после ошибки.
              e.target.value = ''
            }}
          />
          <p className="basis-full text-xs text-muted-foreground">
            {full
              ? t('stickerLimit', { max: STICKER_LIMITS.STICKERS_PER_SET_MAX })
              : t('uploadHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
