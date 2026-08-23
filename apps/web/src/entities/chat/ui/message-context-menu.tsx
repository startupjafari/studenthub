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
  SmilePlus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { CHAT_REACTION_EMOJIS, MESSAGE_EDIT_WINDOW_MS } from '@studenthub/shared-config'
import { EmojiPicker } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useSheetDragClose, useBodyScrollLock } from '../../../shared/lib'
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
  // §11: полный emoji-picker для реакции (по «+» в ряду быстрых реакций).
  const [pickerOpen, setPickerOpen] = useState(false)

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

  // Свайп вниз закрывает нижний лист (Telegram-стиль). Жест — через общий хук: touchmove вешается
  // не-passive и делает preventDefault во время драга, поэтому страница под шторкой не скроллится
  // и не срабатывает iOS pull-to-refresh (один жест — только шторке).
  const sheetRef = useSheetDragClose<HTMLDivElement>(onClose)
  useBodyScrollLock()

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

  // Ряд реакций: внутренняя обёртка w-max+mx-auto центрирует эмодзи, когда они влезают, и позволяет
  // прокрутку по горизонтали, когда нет (узкий экран / много эмодзи) — иначе крайние обрезались.
  const reactionsRow = (big: boolean): React.ReactNode => (
    <div className="overflow-x-auto border-b border-border px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mx-auto flex w-max items-center gap-0.5">
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
        {/* §11: открыть полный пикер для реакции любым emoji. */}
        <button
          type="button"
          aria-label={t('emoji')}
          onClick={() => setPickerOpen(true)}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform hover:scale-110 hover:bg-muted active:scale-95',
            big ? 'size-11' : 'size-8',
          )}
        >
          <SmilePlus className={big ? 'size-6' : 'size-5'} aria-hidden />
        </button>
      </div>
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
              variant === 'sheet' ? 'gap-3 px-4 py-3 text-base' : 'gap-2 px-3 py-2 text-sm',
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
        className={cn(
          'absolute hidden md:block',
          pickerOpen
            ? ''
            : 'w-60 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg',
        )}
      >
        {pickerOpen ? (
          <EmojiPicker
            searchPlaceholder={t('emojiSearch')}
            onPick={(emoji) => {
              actions.onReact(emoji)
              onClose()
            }}
          />
        ) : (
          <>
            {reactionsRow(false)}
            {actionsList('menu')}
          </>
        )}
      </div>

      {/* Мобильный: нижний лист. Тянется/закрывается свайпом вниз. */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] shadow-lg duration-200 animate-in slide-in-from-bottom md:hidden"
      >
        <div
          className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30"
          aria-hidden
        />
        {pickerOpen ? (
          <div className="p-2">
            <EmojiPicker
              className="w-full"
              searchPlaceholder={t('emojiSearch')}
              onPick={(emoji) => {
                actions.onReact(emoji)
                onClose()
              }}
            />
          </div>
        ) : (
          <>
            {reactionsRow(true)}
            {actionsList('sheet')}
          </>
        )}
      </div>
    </div>
  )
}
