'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Bookmark,
  BookmarkMinus,
  Flag,
  Link2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Send,
  Trash2,
} from 'lucide-react'
import { canFileComplaint } from '@studenthub/shared-schemas'
import {
  deletePostRequest,
  pinPostRequest,
  publishPostRequest,
  postKeys,
  type FeedPost,
} from '../../../entities/post'
import { EditPostModal } from '../../../features/edit-post'
import { postUrl } from '../../../features/share-post'
import { ReportModal } from '../../../features/report-content'
import { MenuSeparator, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useAppSelector } from '../../../shared/store'

// Меню «•••» публикации: ссылка и закладка — всем, правка и публикация черновика — автору,
// жалоба — читателю, закрепление и удаление — по правам (их считает сервер). Пункты, которых
// у зрителя нет, не показываются вовсе. Лёгкий поповер: закрывается по клику вне/Esc.
export function PostTileMenu({
  post,
  canModerate,
  canDelete,
  isMine,
  bookmark,
  onDeleted,
  triggerClassName,
}: {
  post: FeedPost
  canModerate: boolean
  canDelete: boolean
  /** Свой пост: на себя не жалуются. */
  isMine: boolean
  /** Закладка поста: пункт «В избранное» / «Убрать из избранного». */
  bookmark?: { saved: boolean; toggle: () => void }
  /** Вызывается после удаления — лайтбоксу нужно закрыться, он показывает удалённый пост. */
  onDeleted?: () => void
  /** Оформление кнопки «•••» — например, светлая на затемнении поверх фото в сетке. */
  triggerClassName?: string
}) {
  const t = useTranslations('Feed')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myRole = useAppSelector((s) => s.auth.role)
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
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
  // Черновик — состояние в один конец, пока его нельзя отправить в ленту: статус задавался
  // только при создании, а правка меняет лишь заголовок и текст.
  const publishMut = useMutation({
    mutationFn: () => publishPostRequest(post.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('published'))
      setOpen(false)
    },
    onError: err,
  })
  const delMut = useMutation({
    mutationFn: () => deletePostRequest(post.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: postKeys.all })
      toast.success(t('deleted'))
      onDeleted?.()
    },
    onError: err,
  })

  // «Пожаловаться» — читателю, которому сервер жалобу примет (студент, староста,
  // преподаватель: COMPLAINT_REPORTER_ROLES). Деканату, админам и работодателю пункт
  // раньше показывался и упирался в 403 — модерация у них своя.
  const canReport = !isMine && canFileComplaint(myRole)

  async function copyLink(): Promise<void> {
    setOpen(false)
    try {
      await navigator.clipboard.writeText(postUrl(post.id))
      toast.success(t('linkCopied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }
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
        title={t('actions')}
        className={cn(
          'flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          triggerClassName,
        )}
      >
        <MoreHorizontal className="size-[1.125rem]" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 duration-(--motion-menu) motion-reduce:animate-none"
        >
          <button type="button" role="menuitem" className={item} onClick={() => void copyLink()}>
            <Link2 className="size-4 text-muted-foreground" aria-hidden />
            {t('copyLink')}
          </button>
          {bookmark && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                bookmark.toggle()
              }}
            >
              {bookmark.saved ? (
                <BookmarkMinus className="size-4 text-muted-foreground" aria-hidden />
              ) : (
                <Bookmark className="size-4 text-muted-foreground" aria-hidden />
              )}
              {bookmark.saved ? t('unbookmark') : t('bookmark')}
            </button>
          )}
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
          {/* Публикация — только своего черновика: у отложенного поста есть своё время,
              и досрочная отправка противоречила бы выставленному расписанию. */}
          {isMine && post.status === 'DRAFT' && (
            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={publishMut.isPending}
              onClick={() => publishMut.mutate()}
            >
              <Send className="size-4 text-muted-foreground" aria-hidden />
              {t('publishPost')}
            </button>
          )}
          {isMine && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                setEditing(true)
              }}
            >
              <Pencil className="size-4 text-muted-foreground" aria-hidden />
              {t('editPost')}
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
          {/* Удаление — опасное, поэтому последним и за линией (правило для всех меню). */}
          {canDelete && <MenuSeparator />}
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

      {editing && <EditPostModal post={post} onClose={() => setEditing(false)} />}

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
