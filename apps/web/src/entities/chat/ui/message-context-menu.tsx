'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCheck, Copy, Forward, Link2, Pencil, Pin, PinOff, Reply, Trash2 } from 'lucide-react'
import { CHAT_REACTION_EMOJIS, MESSAGE_EDIT_WINDOW_MS } from '@studenthub/shared-config'
import { cn } from '../../../shared/lib/utils'
import type { ChatMessage } from '../model/types'

export interface MessageMenuActions {
  onReact: (emoji: string) => void
  onReply: () => void
  onEdit: () => void
  onPin: () => void
  onCopy: () => void
  onCopyLink: () => void
  onForward: () => void
  onDelete: () => void
  onSelect: () => void
}

// Контекстное меню сообщения в стиле Telegram (Ф9+): быстрый ряд реакций сверху + действия.
// Открывается по правому клику/кнопке-шеврону у точки (x, y); закрывается по клику вне/Escape.
export function MessageContextMenu({
  message,
  mine,
  x,
  y,
  onClose,
  actions,
}: {
  message: ChatMessage
  mine: boolean
  x: number
  y: number
  onClose: () => void
  actions: MessageMenuActions
}) {
  const t = useTranslations('Chats')
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Удержать меню в пределах вьюпорта.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - width - 8)
    const top = Math.min(y, window.innerHeight - height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const item = (
    key: string,
    label: string,
    Icon: typeof Reply,
    onClick: () => void,
    danger = false,
  ) => (
    <button
      key={key}
      type="button"
      onClick={run(onClick)}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
        danger ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50" role="menu" aria-label={t('messageActions')}>
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        className="absolute w-60 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg"
      >
        {/* Быстрый ряд реакций — все эмодзи в одинаковых квадратных боксах, глифы одного размера */}
        <div className="flex items-center justify-between gap-0.5 border-b border-border px-2 py-2">
          {CHAT_REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={run(() => actions.onReact(emoji))}
              className="flex size-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 hover:bg-muted"
            >
              <span className="flex size-5 items-center justify-center overflow-hidden text-center text-[18px] leading-none">
                {emoji}
              </span>
            </button>
          ))}
        </div>
        {/* Действия */}
        <div className="py-1">
          {item('reply', t('reply'), Reply, actions.onReply)}
          {mine &&
            Date.now() - new Date(message.createdAt).getTime() < MESSAGE_EDIT_WINDOW_MS &&
            item('edit', t('edit'), Pencil, actions.onEdit)}
          {item(
            'pin',
            message.pinnedAt ? t('unpin') : t('pin'),
            message.pinnedAt ? PinOff : Pin,
            actions.onPin,
          )}
          {item('copy', t('copyText'), Copy, actions.onCopy)}
          {item('link', t('copyLink'), Link2, actions.onCopyLink)}
          {item('forward', t('forward'), Forward, actions.onForward)}
          {item('select', t('select'), CheckCheck, actions.onSelect)}
          {mine && item('delete', t('delete'), Trash2, actions.onDelete, true)}
        </div>
      </div>
    </div>
  )
}
