'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Flag, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react'
import { deletePostRequest, pinPostRequest, postKeys, type FeedPost } from '../../../entities/post'
import { ReportModal } from '../../../features/report-content'
import { useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Меню действий на своей карточке публикации: закрепить/открепить + удалить — через «•••»
// вместо отдельных иконок (по рекомендации). Лёгкий поповер: закрывается по клику вне/Esc.
export function PostTileMenu({
  post,
  canModerate,
  canDelete,
  isMine,
}: {
  post: FeedPost
  canModerate: boolean
  canDelete: boolean
  /** Свой пост: на себя не жалуются. */
  isMine: boolean
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))

  const pinMut = useMutation({
    mutationFn: () => pinPostRequest(post.id, post.pinnedAt === null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      setOpen(false)
    },
    onError: err,
  })
  const delMut = useMutation({
    mutationFn: () => deletePostRequest(post.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('deleted'))
    },
    onError: err,
  })

  // Меню больше не прячем: «Пожаловаться» доступно любому читателю — до этого
  // подать жалобу из интерфейса было нельзя вовсе, хотя эндпоинт есть с Ф11.
  const canReport = !isMine
  if (!canModerate && !canDelete && !canReport) return null
  const item =
    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={t('actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {canModerate && (
            <button type="button" role="menuitem" className={item} onClick={() => pinMut.mutate()}>
              {post.pinnedAt ? (
                <PinOff className="size-4 text-muted-foreground" aria-hidden />
              ) : (
                <Pin className="size-4 text-muted-foreground" aria-hidden />
              )}
              {post.pinnedAt ? t('unpin') : t('pin')}
            </button>
          )}
          {canReport && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                setReporting(true)
              }}
            >
              <Flag className="size-4 text-muted-foreground" aria-hidden />
              {t('report')}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className={cn(item, 'text-destructive hover:bg-destructive/10')}
              onClick={() => {
                void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                  if (ok) delMut.mutate()
                })
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {t('delete')}
            </button>
          )}
        </div>
      )}

      {reporting && (
        <ReportModal
          targetType="POST"
          targetId={post.id}
          preview={post.content}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  )
}
