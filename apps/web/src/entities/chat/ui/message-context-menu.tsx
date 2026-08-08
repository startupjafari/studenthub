'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  CheckCheck,
  Copy,
  Forward,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
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

interface ActionDef {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

// Блок взаимодействия с сообщением (Telegram-стиль): затемнение фона + быстрый ряд реакций и действия.
// Десктоп — компактное меню у точки (правый клик/шеврон). Мобильный — нижний лист (bottom sheet)
// с крупными целями и safe-area, открывается долгим нажатием.
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

  // Десктопное меню удерживаем в пределах вьюпорта (на мобильном оно скрыто — лист внизу).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (!width || !height) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Свайп вниз закрывает нижний лист (Telegram-стиль): тянем по пальцу, за порогом — доводим и закрываем.
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startY: number; dragging: boolean } | null>(null)
  const onSheetTouchStart = (e: React.TouchEvent): void => {
    const tch = e.touches[0]
    const el = sheetRef.current
    // Не перехватываем жест, если контент проскроллен вниз — сначала скролл.
    if (!tch || (el && el.scrollTop > 0)) {
      drag.current = null
      return
    }
    drag.current = { startY: tch.clientY, dragging: false }
  }
  const onSheetTouchMove = (e: React.TouchEvent): void => {
    const s = drag.current
    const tch = e.touches[0]
    const el = sheetRef.current
    if (!s || !tch || !el) return
    const dy = tch.clientY - s.startY
    if (dy <= 0) {
      if (s.dragging) {
        el.style.transition = 'none'
        el.style.transform = ''
      }
      return
    }
    if (!s.dragging && dy < 6) return // порог: не мешаем тапу по кнопкам
    s.dragging = true
    el.style.transition = 'none'
    el.style.transform = `translateY(${dy}px)`
  }
  const onSheetTouchEnd = (e: React.TouchEvent): void => {
    const s = drag.current
    const el = sheetRef.current
    drag.current = null
    if (!s || !s.dragging || !el) return
    const dy = (e.changedTouches[0]?.clientY ?? s.startY) - s.startY
    if (dy > 96) {
      el.style.transition = 'transform 0.2s ease-in'
      el.style.transform = 'translateY(100%)'
      window.setTimeout(onClose, 170)
    } else {
      el.style.transition = 'transform 0.24s cubic-bezier(0.22, 0.61, 0.36, 1)'
      el.style.transform = ''
    }
  }

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const canEdit =
    mine && Date.now() - new Date(message.createdAt).getTime() < MESSAGE_EDIT_WINDOW_MS
  const items: ActionDef[] = [
    { key: 'reply', label: t('reply'), icon: Reply, onClick: actions.onReply },
    ...(canEdit ? [{ key: 'edit', label: t('edit'), icon: Pencil, onClick: actions.onEdit }] : []),
    {
      key: 'pin',
      label: message.pinnedAt ? t('unpin') : t('pin'),
      icon: message.pinnedAt ? PinOff : Pin,
      onClick: actions.onPin,
    },
    { key: 'copy', label: t('copyText'), icon: Copy, onClick: actions.onCopy },
    { key: 'link', label: t('copyLink'), icon: Link2, onClick: actions.onCopyLink },
    { key: 'forward', label: t('forward'), icon: Forward, onClick: actions.onForward },
    { key: 'select', label: t('select'), icon: CheckCheck, onClick: actions.onSelect },
    ...(mine
      ? [
          {
            key: 'delete',
            label: t('delete'),
            icon: Trash2,
            onClick: actions.onDelete,
            danger: true,
          },
        ]
      : []),
  ]

  const reactionsRow = (big: boolean): React.ReactNode => (
    <div className="flex items-center justify-center gap-0.5 border-b border-border px-2 py-2">
      {CHAT_REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={run(() => actions.onReact(emoji))}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 hover:bg-muted active:scale-95',
            big ? 'size-11' : 'size-8',
          )}
        >
          <span
            className={cn(
              'flex items-center justify-center overflow-hidden leading-none',
              big ? 'text-2xl' : 'text-[18px]',
            )}
          >
            {emoji}
          </span>
        </button>
      ))}
    </div>
  )

  const actionsList = (variant: 'menu' | 'sheet'): React.ReactNode => (
    <div className={variant === 'sheet' ? 'py-1' : 'py-1'}>
      {items.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.key}
            type="button"
            onClick={run(it.onClick)}
            className={cn(
              'flex w-full items-center text-left transition-colors hover:bg-muted',
              variant === 'sheet' ? 'gap-3 px-4 py-3 text-base' : 'gap-2.5 px-3 py-2 text-sm',
              it.danger ? 'text-destructive' : 'text-foreground',
            )}
          >
            <Icon
              className={cn('shrink-0 opacity-80', variant === 'sheet' ? 'size-5' : 'size-4')}
              aria-hidden
            />
            {it.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 bg-foreground/40 duration-150 animate-in fade-in md:bg-transparent"
      role="menu"
      aria-label={t('messageActions')}
      onClick={onClose}
    >
      {/* Десктоп: компактное меню у точки нажатия. */}
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className="absolute hidden w-60 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg md:block"
      >
        {reactionsRow(false)}
        {actionsList('menu')}
      </div>

      {/* Мобильный: нижний лист. Тянется/закрывается свайпом вниз. */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        className="fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] shadow-lg duration-200 animate-in slide-in-from-bottom md:hidden"
      >
        <div
          className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30"
          aria-hidden
        />
        {reactionsRow(true)}
        {actionsList('sheet')}
      </div>
    </div>
  )
}
