'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Smile } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

interface CommentItem {
  id: string
  content: string
  createdAt: string
  authorId: string
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

// Быстрый набор эмодзи (как в комментариях поста).
const EMOJI_SET = [
  '😀',
  '😂',
  '😍',
  '🥰',
  '😎',
  '🤩',
  '😅',
  '😊',
  '👍',
  '👏',
  '🙌',
  '🔥',
  '❤️',
  '💯',
  '🎉',
  '✨',
  '😮',
  '🤔',
  '🙏',
  '💪',
  '✅',
  '⭐',
  '😢',
  '😉',
]

// Компактное относительное время («5 нед. назад») — как в лайтбоксе поста.
const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]
function relTime(iso: string, locale: string): string {
  const diffSec = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [unit, secs] of REL_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit)
  }
  return rtf.format(Math.round(diffSec / 60), 'minute')
}

function initials(a: { firstName: string; lastName: string }): string {
  return `${a.lastName[0] ?? ''}${a.firstName[0] ?? ''}`.toUpperCase()
}

// Универсальная лента комментариев (статьи/опросы) в стиле поста: аватар · имя+текст в строку ·
// относительное время; снизу — плоское поле ввода с эмодзи и «Опубликовать». Данные инжектит вызывающий.
export function ContentComments({
  queryKey,
  fetchFn,
  addFn,
  deleteFn,
  ownerId,
}: {
  queryKey: readonly unknown[]
  fetchFn: () => Promise<CommentItem[]>
  addFn: (content: string) => Promise<unknown>
  deleteFn: (commentId: string) => Promise<void>
  ownerId: string
}) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)

  const q = useQuery({ queryKey, queryFn: fetchFn })
  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidate = () => void qc.invalidateQueries({ queryKey })

  const addMut = useMutation({
    mutationFn: () => addFn(text.trim()),
    onSuccess: () => {
      invalidate()
      setText('')
    },
    onError: err,
  })
  const delMut = useMutation({
    mutationFn: (commentId: string) => deleteFn(commentId),
    onSuccess: invalidate,
    onError: err,
  })

  // Авто-высота поля ввода (перенос строки по Shift+Enter).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }, [text])

  // Закрытие пикера эмодзи по клику вне области / Esc.
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [emojiOpen])

  function insertEmoji(emoji: string): void {
    const el = inputRef.current
    if (!el) {
      setText((p) => p + emoji)
      return
    }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    })
  }

  const comments = q.data ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Список комментариев (скролл). Пусто/загрузка — сообщение по центру области. */}
      {q.isLoading || comments.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center py-8 text-center text-sm text-muted-foreground">
          {q.isLoading ? t('commentsLoading') : t('commentsEmpty')}
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-1">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-2">
              <ProfileLink userId={c.author.id} className="shrink-0">
                <Avatar className="size-8">
                  {c.author.avatarUrl && <AvatarImage src={c.author.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[10px]">{initials(c.author)}</AvatarFallback>
                </Avatar>
              </ProfileLink>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">
                  <ProfileLink
                    userId={c.author.id}
                    className="mr-1.5 font-semibold hover:text-primary hover:underline"
                  >
                    {c.author.lastName} {c.author.firstName}
                  </ProfileLink>
                  <span className="whitespace-pre-wrap break-words">{c.content}</span>
                </p>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{relTime(c.createdAt, locale)}</span>
                  {(c.authorId === myId || ownerId === myId) && (
                    <button
                      type="button"
                      onClick={() => delMut.mutate(c.id)}
                      className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      {t('delete')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Поле ввода — плоское, как в посте: эмодзи · многострочное поле · «Опубликовать» */}
      <div className="relative mt-2 flex items-end gap-2 border-t border-border pt-2.5">
        <div ref={emojiRef} className="relative shrink-0">
          <button
            type="button"
            aria-label={t('emoji')}
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((o) => !o)}
            className={cn(
              'flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              emojiOpen && 'bg-muted text-foreground',
            )}
          >
            <Smile className="size-6" aria-hidden />
          </button>
          {emojiOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-2 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-border bg-popover p-2 shadow-lg">
              {EMOJI_SET.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => insertEmoji(e)}
                  className="flex size-7 items-center justify-center rounded-md text-lg transition-colors hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (text.trim().length > 0) addMut.mutate()
            }
          }}
          placeholder={t('commentPlaceholder')}
          className="max-h-28 min-h-8 min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-snug outline-none placeholder:text-muted-foreground"
        />

        <button
          type="button"
          onClick={() => addMut.mutate()}
          disabled={text.trim().length === 0 || addMut.isPending}
          className="shrink-0 self-center text-sm font-semibold text-primary transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {t('publish')}
        </button>
      </div>
    </div>
  )
}
