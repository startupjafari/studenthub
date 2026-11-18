'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Flag, Link2, Minus, Plus } from 'lucide-react'
import {
  addStickerSetRequest,
  fetchStickerSetPreview,
  removeStickerSetRequest,
  stickerSetLink,
  userStickerKeys,
  type PanelSticker,
  type StickerSetPreviewQuery,
} from '../../../entities/sticker-set'
import { AnimatedImage, Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/** Превью набора: общий кэш для окна, его заголовка и страницы ссылки. */
export function useStickerSetPreview(query: StickerSetPreviewQuery) {
  return useQuery({
    queryKey: userStickerKeys.preview(query),
    queryFn: () => fetchStickerSetPreview(query),
    retry: (count, e) => (e as { code?: string }).code !== 'NOT_FOUND' && count < 2,
  })
}

/** Скопировать ссылку на набор и сказать об этом. */
export async function copyStickerSetLink(
  slug: string,
  text: { copied: string; failed: string },
): Promise<void> {
  try {
    await navigator.clipboard.writeText(stickerSetLink(slug))
    toast.success(text.copied)
  } catch {
    toast.error(text.failed)
  }
}

/**
 * Окно набора — как в Telegram: сетка стикеров, «Добавить стикеры» / «Убрать», «Поделиться»
 * ссылкой и «Пожаловаться». Открывается по ссылке `/addstickers/<slug>` и по нажатию на
 * стикер в переписке. Автор набора не показывается — только «это ваш набор».
 *
 * `onSend` — нажатие на стикер отправляет его в открытый чат (окно из переписки); без него
 * стикеры просто смотрят.
 */
export function StickerSetPreviewContent({
  query,
  onReport,
  onSend,
}: {
  query: StickerSetPreviewQuery
  onReport?: (setId: string) => void
  onSend?: (sticker: PanelSticker) => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const preview = useStickerSetPreview(query)

  const toggle = useMutation({
    mutationFn: ({ id, add }: { id: string; add: boolean }) =>
      add ? addStickerSetRequest(id) : removeStickerSetRequest(id),
    onSuccess: (_d, { add }) => {
      void qc.invalidateQueries({ queryKey: userStickerKeys.all })
      toast.success(add ? t('tgStickers.added') : t('tgStickers.removedFromPanel'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  if (preview.isPending) {
    return (
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" aria-busy>
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    )
  }
  if (preview.isError) {
    const notFound = (preview.error as { code?: string }).code === 'NOT_FOUND'
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
        <p>{notFound ? t('tgStickers.notFound') : t('tgStickers.previewLoadError')}</p>
        {!notFound && (
          <Button type="button" variant="outline" size="sm" onClick={() => void preview.refetch()}>
            {t('tgComposer.retry')}
          </Button>
        )}
      </div>
    )
  }

  const set = preview.data
  const user = set.kind === 'USER'
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('tgStickers.setCount', { count: set.stickers.length })}
        {set.isMine && ` · ${t('tgStickers.mine')}`}
        {!user && ` · ${t('tgStickers.catalogNote')}`}
      </p>
      {set.stickers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('tgStickers.emptySet')}</p>
      ) : (
        <ul className="grid grid-cols-4 gap-1 sm:grid-cols-5" aria-label={set.title}>
          {set.stickers.map((s) => {
            const alt = s.emoji
              ? t('tgComposer.stickerAlt', { emoji: s.emoji })
              : t('previewSticker')
            const image = (
              <AnimatedImage
                src={s.url}
                animated={s.animated}
                alt={onSend ? '' : alt}
                loading="lazy"
                draggable={false}
                className="size-full object-contain"
              />
            )
            return (
              <li key={s.id} className="aspect-square">
                {onSend ? (
                  <button
                    type="button"
                    onClick={() => onSend(s)}
                    aria-label={t('tgStickers.sendSticker', { sticker: alt })}
                    className="flex size-full cursor-pointer items-center justify-center rounded-xl p-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 motion-safe:active:scale-95"
                  >
                    {image}
                  </button>
                ) : (
                  <div className="flex size-full items-center justify-center p-1">{image}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {user && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className={cn('flex-1', set.isAdded && 'min-w-40')}
            variant={set.isAdded ? 'outline' : 'default'}
            loading={toggle.isPending}
            onClick={() => toggle.mutate({ id: set.id, add: !set.isAdded })}
          >
            {set.isAdded ? (
              <Minus className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {set.isAdded ? t('tgStickers.removeFromPanel') : t('tgStickers.addSet')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void copyStickerSetLink(set.slug, {
                copied: t('tgStickers.linkCopied'),
                failed: t('tgStickers.linkCopyFailed'),
              })
            }
          >
            <Link2 className="size-4" aria-hidden />
            {t('tgStickers.share')}
          </Button>
          {onReport && !set.isMine && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onReport(set.id)}
            >
              <Flag className="size-4" aria-hidden />
              {t('tgStickers.report')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
