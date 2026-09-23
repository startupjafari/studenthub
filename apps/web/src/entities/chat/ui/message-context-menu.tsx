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
import {
  AnchoredMenuLayer,
  EmojiPicker,
  MENU_EXIT_MS,
  MenuSeparator,
  splitDanger,
  type MenuAnchor,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  useSheetDragClose,
  useBodyScrollLock,
  useScrollRow,
  useDismissAnimation,
} from '../../../shared/lib'
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

/** Пузырь, из которого выросло меню (долгое нажатие на телефоне). */
export type MessageMenuAnchor = MenuAnchor

interface ActionDef {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

/**
 * Ряд быстрых реакций. Отдельный компонент, а не функция, возвращающая разметку, ровно
 * из-за прокрутки: `useScrollRow` держит ОДИН узел, а рядов на экране два — компактный
 * в десктопном меню и пилюля над пузырём на телефоне. Оба монтируются всегда (прячет их
 * медиазапрос, а не условие), и общий контроллер доставался тому, кто смонтировался
 * последним, — мобильному. На ПК ряд из-за этого не тянулся мышью, не крутился колесом
 * и не затухал у краёв: вся механика висела на невидимом соседе.
 *
 * Внутренняя обёртка `w-max mx-auto` центрирует эмодзи, когда они влезают, и разрешает
 * прокрутку, когда нет — иначе крайние обрезались бы без возможности до них добраться.
 */
function ReactionsRow({
  variant = 'menu',
  onReact,
  onOpenPicker,
  pickerLabel,
}: {
  /** `pill` — отдельная плашка над пузырём (телефон), цели под палец; `menu` — строка в меню ПК. */
  variant?: 'menu' | 'pill'
  onReact: (emoji: string) => void
  onOpenPicker: () => void
  pickerLabel: string
}) {
  const row = useScrollRow<HTMLDivElement>()
  const pill = variant === 'pill'
  const btn = cn(
    'flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 hover:bg-muted active:scale-95',
    pill ? 'size-11' : 'size-10',
  )

  return (
    <div
      ref={row.ref}
      className={cn(
        'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        pill
          ? // Без своего backdrop-blur: размытие даёт затемнение под пилюлей, а второй фильтр
            // поверх первого на телефоне стоит кадров.
            'max-w-full rounded-full border border-border bg-popover px-1.5 py-1 shadow-xl'
          : 'border-b border-border px-2 py-2',
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
      )}
      style={{ maskImage: row.fadeMask, WebkitMaskImage: row.fadeMask }}
    >
      <div className="mx-auto flex w-max items-center gap-0.5">
        {CHAT_REACTION_EMOJIS.map((emoji) => (
          <button key={emoji} type="button" onClick={() => onReact(emoji)} className={btn}>
            <span
              className={cn(
                'flex items-center justify-center overflow-hidden leading-none',
                pill ? 'text-2xl' : 'text-[22px]',
              )}
            >
              {emoji}
            </span>
          </button>
        ))}
        {/* §11: открыть полный пикер для реакции любым emoji. */}
        <button
          type="button"
          aria-label={pickerLabel}
          onClick={onOpenPicker}
          className={cn(btn, 'text-muted-foreground')}
        >
          <SmilePlus className={pill ? 'size-6' : 'size-5'} aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * Нижний лист с полным emoji-пикером (телефон). Отдельный компонент, потому что
 * `useSheetDragClose` вешает жест на узел в момент монтирования: живя в родителе, хук получал
 * бы ref листа, которого тогда ещё нет, — и свайп вниз перестал бы его закрывать.
 */
function EmojiPickerSheet({
  searchPlaceholder,
  onPick,
  onClose,
}: {
  searchPlaceholder: string
  onPick: (emoji: string) => void
  onClose: () => void
}) {
  const ref = useSheetDragClose<HTMLDivElement>(onClose)

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] shadow-lg duration-200 animate-in slide-in-from-bottom md:hidden"
    >
      <div
        className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30"
        aria-hidden
      />
      <div className="p-2">
        <EmojiPicker className="w-full" searchPlaceholder={searchPlaceholder} onPick={onPick} />
      </div>
    </div>
  )
}

// Блок взаимодействия с сообщением (Telegram-стиль): затемнение фона + быстрый ряд реакций и
// действия. Десктоп — компактное меню у точки (правый клик/шеврон). Телефон — меню у самого
// пузыря (`AnchoredMenuLayer`): реакции над сообщением, действия под ним. Нижний лист остался
// ровно под полным emoji-пикером: там нужен весь экран, и он не привязан к месту нажатия.
export function MessageContextMenu({
  message,
  mine,
  x,
  y,
  anchor,
  onClose,
  actions,
}: {
  message: ChatMessage
  mine: boolean
  x: number
  y: number
  /** Пузырь под пальцем — есть только у долгого нажатия (тач). */
  anchor?: MessageMenuAnchor | null
  onClose: () => void
  actions: MessageMenuActions
}) {
  const t = useTranslations('Chats')
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // §11: полный emoji-picker для реакции (по «+» в ряду быстрых реакций).
  const [pickerOpen, setPickerOpen] = useState(false)
  // Меню не исчезает кадром: сначала уход, потом размонтирование родителем.
  const { closing, dismiss } = useDismissAnimation(onClose, MENU_EXIT_MS)

  // Десктопное меню удерживаем в пределах вьюпорта (на мобильном оно скрыто — меню у пузыря).
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
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  useBodyScrollLock()

  const run = (fn: () => void) => () => {
    fn()
    dismiss()
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

  const actionsList = (variant: 'menu' | 'card'): React.ReactNode => {
    const row = (it: ActionDef): React.ReactNode => {
      const Icon = it.icon
      return (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          onClick={run(it.onClick)}
          className={cn(
            'flex w-full cursor-pointer items-center text-left transition-colors hover:bg-muted active:bg-muted',
            variant === 'card' ? 'gap-3 px-4 py-2.5 text-[15px]' : 'gap-2 px-3 py-2 text-sm',
            it.danger ? 'text-destructive' : 'text-foreground',
          )}
        >
          <Icon
            className={cn('shrink-0 opacity-80', variant === 'card' ? 'size-5' : 'size-4')}
            aria-hidden
          />
          <span className="truncate">{it.label}</span>
        </button>
      )
    }
    // Опасные пункты — всегда в конце и за линией (см. MenuSeparator).
    const { safe, danger } = splitDanger(items)
    return (
      <div className="py-1">
        {safe.map(row)}
        {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
        {danger.map(row)}
      </div>
    )
  }

  const reactAndClose = (emoji: string): void => {
    actions.onReact(emoji)
    dismiss()
  }

  return (
    <div
      // Маркер для глобального Esc (shared/lib/use-escape-back).
      data-overlay
      className={cn(
        'fixed inset-0 z-50 bg-overlay/40 backdrop-blur-sm duration-150 md:bg-transparent md:backdrop-blur-none',
        // Во время ухода слой уже не ловит нажатия: второй тап по пункту ничего не повторит.
        closing ? 'pointer-events-none animate-out fade-out' : 'animate-in fade-in',
      )}
      role="menu"
      aria-label={t('messageActions')}
      onClick={dismiss}
    >
      {/* Десктоп: компактное меню у точки нажатия. */}
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute hidden duration-150 md:block',
          closing ? 'animate-out fade-out zoom-out-95' : 'animate-in fade-in zoom-in-95',
          pickerOpen
            ? ''
            : 'w-72 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg',
        )}
      >
        {pickerOpen ? (
          <EmojiPicker searchPlaceholder={t('emojiSearch')} onPick={reactAndClose} />
        ) : (
          <>
            <ReactionsRow
              onReact={reactAndClose}
              onOpenPicker={() => setPickerOpen(true)}
              pickerLabel={t('emoji')}
            />
            {actionsList('menu')}
          </>
        )}
      </div>

      {/* Телефон: реакции и действия у самого пузыря; полный пикер — нижним листом. */}
      {pickerOpen ? (
        <EmojiPickerSheet
          searchPlaceholder={t('emojiSearch')}
          onPick={reactAndClose}
          onClose={dismiss}
        />
      ) : (
        <AnchoredMenuLayer
          anchor={anchor}
          fallbackY={y}
          align={mine ? 'end' : 'start'}
          closing={closing}
          onBackdropTap={dismiss}
          above={
            <ReactionsRow
              variant="pill"
              onReact={reactAndClose}
              onOpenPicker={() => setPickerOpen(true)}
              pickerLabel={t('emoji')}
            />
          }
          card={actionsList('card')}
        />
      )}
    </div>
  )
}
