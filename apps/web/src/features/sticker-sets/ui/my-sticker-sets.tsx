'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { USER_STICKER_LIMITS } from '@studenthub/shared-schemas'
import {
  closeMyStickerSets,
  createMyStickerSetRequest,
  deleteMyStickerRequest,
  deleteMyStickerSetRequest,
  fetchMyStickerSets,
  pickStickerSource,
  renameMyStickerSetRequest,
  reorderMyStickersRequest,
  useStickerUi,
  userStickerKeys,
  type MyStickerSet,
} from '../../../entities/sticker-set'
import { AnimatedImage, Button, Modal, PromptDialog, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { copyStickerSetLink } from './sticker-set-preview'

/** Пока в наборе есть собираемые стикеры — перечитываем список. */
const PROCESSING_POLL_MS = 2000

export function MyStickerSetsHost() {
  const { manage } = useStickerUi()
  if (!manage) return null
  return <MyStickerSets onClose={closeMyStickerSets} />
}

/**
 * «Мои наборы» из панели стикеров: переименовать, переставить и убрать стикеры, поделиться
 * ссылкой, удалить набор, добавить стикер (открывает редактор с этим набором).
 */
function MyStickerSets({ onClose }: { onClose: () => void }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<MyStickerSet | null>(null)
  const sets = useQuery({
    queryKey: userStickerKeys.mine(),
    queryFn: fetchMyStickerSets,
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.stickers.some((x) => x.status === 'PROCESSING'))
        ? PROCESSING_POLL_MS
        : false,
  })
  const onError = (e: unknown): void => {
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  }
  const refresh = (): void => void qc.invalidateQueries({ queryKey: userStickerKeys.all })

  const create = useMutation({
    mutationFn: (title: string) => createMyStickerSetRequest({ title }),
    onSuccess: refresh,
    onError,
  })
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameMyStickerSetRequest(id, title),
    onSuccess: refresh,
    onError,
  })
  const removeSet = useMutation({
    mutationFn: (id: string) => deleteMyStickerSetRequest(id),
    onSuccess: () => {
      refresh()
      toast.success(t('tgStickers.setDeleted'))
    },
    onError,
  })
  const removeSticker = useMutation({
    mutationFn: ({ setId, id }: { setId: string; id: string }) => deleteMyStickerRequest(setId, id),
    onSuccess: refresh,
    onError,
  })
  const reorder = useMutation({
    mutationFn: ({ setId, ids }: { setId: string; ids: string[] }) =>
      reorderMyStickersRequest(setId, ids),
    onSuccess: refresh,
    onError,
  })

  const move = (set: MyStickerSet, index: number, dir: -1 | 1): void => {
    const ids = set.stickers.map((s) => s.id)
    const to = index + dir
    if (to < 0 || to >= ids.length) return
    ;[ids[index], ids[to]] = [ids[to]!, ids[index]!]
    reorder.mutate({ setId: set.id, ids })
  }

  const list = sets.data ?? []
  const atLimit = list.length >= USER_STICKER_LIMITS.SETS_PER_USER

  return (
    <Modal
      onClose={onClose}
      title={t('tgStickers.manageTitle')}
      size="lg"
      height="stable"
      headerAction={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={atLimit}
          title={
            atLimit
              ? t('tgStickers.setsLimit', { max: USER_STICKER_LIMITS.SETS_PER_USER })
              : undefined
          }
          onClick={() => setCreating(true)}
        >
          <Plus className="size-4" aria-hidden />
          {t('tgStickers.newSet')}
        </Button>
      }
    >
      {sets.isPending ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : sets.isError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
          <p>{t('tgStickers.previewLoadError')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void sets.refetch()}>
            {t('tgComposer.retry')}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
          <p>{t('tgStickers.manageEmpty')}</p>
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('tgStickers.newSet')}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((set) => (
            <li key={set.id} className="rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate font-medium">{set.title}</h3>
                {set.removed && (
                  <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                    <AlertTriangle className="size-3" aria-hidden />
                    {t('tgStickers.removedBadge')}
                  </span>
                )}
                {!set.removed && (
                  <>
                    <IconButton
                      label={t('tgStickers.copyLink')}
                      onClick={() =>
                        void copyStickerSetLink(set.slug, {
                          copied: t('tgStickers.linkCopied'),
                          failed: t('tgStickers.linkCopyFailed'),
                        })
                      }
                    >
                      <Link2 className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton label={t('tgStickers.rename')} onClick={() => setRenaming(set)}>
                      <Pencil className="size-4" aria-hidden />
                    </IconButton>
                  </>
                )}
                <IconButton
                  label={t('tgStickers.deleteSet')}
                  danger
                  onClick={() =>
                    void confirm({
                      title: t('tgStickers.deleteSet'),
                      description: t('tgStickers.deleteSetConfirm', { title: set.title }),
                      confirmLabel: t('tgStickers.delete'),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) removeSet.mutate(set.id)
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </div>
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label={set.title}>
                {set.stickers.map((s, i) => (
                  <li key={s.id} className="group relative aspect-square rounded-lg bg-muted/40">
                    {s.status === 'READY' && s.url ? (
                      <AnimatedImage
                        src={s.url}
                        animated={s.animated}
                        alt={
                          s.emoji
                            ? t('tgComposer.stickerAlt', { emoji: s.emoji })
                            : t('previewSticker')
                        }
                        loading="lazy"
                        className="size-full object-contain p-1"
                      />
                    ) : (
                      <div
                        role="status"
                        className={cn(
                          'flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[0.65rem]',
                          s.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {s.status === 'FAILED' ? (
                          <AlertTriangle className="size-4" aria-hidden />
                        ) : (
                          <Loader2
                            className="size-4 animate-spin motion-reduce:animate-none"
                            aria-hidden
                          />
                        )}
                        {s.status === 'FAILED'
                          ? t('tgStickers.failedShort')
                          : t('tgStickers.processingShort')}
                      </div>
                    )}
                    {/* Действия над стикером: видны при наведении и фокусе, на телефоне — всегда. */}
                    <div className="absolute inset-x-0 bottom-0 flex justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      <span className="flex">
                        <MiniButton
                          label={t('tgStickers.moveEarlier')}
                          disabled={i === 0 || reorder.isPending}
                          onClick={() => move(set, i, -1)}
                        >
                          <ChevronLeft className="size-3.5" aria-hidden />
                        </MiniButton>
                        <MiniButton
                          label={t('tgStickers.moveLater')}
                          disabled={i === set.stickers.length - 1 || reorder.isPending}
                          onClick={() => move(set, i, 1)}
                        >
                          <ChevronRight className="size-3.5" aria-hidden />
                        </MiniButton>
                      </span>
                      <MiniButton
                        label={t('tgStickers.deleteSticker')}
                        onClick={() => removeSticker.mutate({ setId: set.id, id: s.id })}
                      >
                        <X className="size-3.5" aria-hidden />
                      </MiniButton>
                    </div>
                  </li>
                ))}
                {!set.removed && set.stickers.length < USER_STICKER_LIMITS.STICKERS_PER_SET && (
                  <li className="aspect-square">
                    <button
                      type="button"
                      onClick={() => pickStickerSource({ setId: set.id })}
                      aria-label={t('tgStickers.addSticker')}
                      title={t('tgStickers.addSticker')}
                      className="flex size-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <Plus className="size-5" aria-hidden />
                    </button>
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <PromptDialog
        open={creating}
        title={t('tgStickers.newSet')}
        placeholder={t('tgStickers.newSetPlaceholder')}
        required
        submitLabel={t('tgStickers.create')}
        cancelLabel={tCommon('cancel')}
        onSubmit={(title) => {
          setCreating(false)
          create.mutate(title.trim().slice(0, USER_STICKER_LIMITS.TITLE_MAX))
        }}
        onClose={() => setCreating(false)}
      />
      <PromptDialog
        open={renaming !== null}
        title={t('tgStickers.rename')}
        placeholder={t('tgStickers.newSetPlaceholder')}
        required
        defaultValue={renaming?.title}
        submitLabel={tCommon('save')}
        cancelLabel={tCommon('cancel')}
        onSubmit={(title) => {
          if (renaming) {
            rename.mutate({
              id: renaming.id,
              title: title.trim().slice(0, USER_STICKER_LIMITS.TITLE_MAX),
            })
          }
          setRenaming(null)
        }}
        onClose={() => setRenaming(null)}
      />
    </Modal>
  )
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
        danger ? 'text-destructive' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function MiniButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
