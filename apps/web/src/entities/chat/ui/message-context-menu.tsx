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
import {
  useSheetDragClose,
  useBodyScrollLock,
  useScrollRow,
  prefersReducedMotion,
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

/**
 * Пузырь, из которого выросло меню (долгое нажатие на телефоне). Меню поднимает его
 * снимок над затемнением и раскладывает вокруг него реакции и действия, поэтому ему нужны
 * и живой узел (для клона), и его экранная геометрия на момент нажатия.
 */
export interface MessageMenuAnchor {
  node: HTMLElement
  rect: { top: number; left: number; width: number; height: number }
}

interface ActionDef {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

/** Отступ от краёв экрана и зазор между блоками мобильной раскладки. */
const EDGE = 12
const GAP = 8
/** Ниже этого снимок пузыря не ужимаем — он становится прокручиваемым. */
const MIN_BUBBLE = 96

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
          ? 'max-w-full rounded-full border border-border bg-popover/95 px-1.5 py-1 shadow-xl backdrop-blur-md'
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
 * Снимок пузыря над затемнением: клон живого узла, а не пересборка разметки.
 *
 * Клон, потому что пузырь — это уже отрисованное сообщение со всем, что в нём бывает
 * (вложения, цитата, опрос, реакции), и повторять эту сборку вторым кодом значит гарантированно
 * разойтись с оригиналом. Клон инертен: обработчики React на него не переносятся, а hover-кнопка
 * «Ответить» внутри остаётся невидимой — её показывает `group-hover`, а группы-родителя здесь нет.
 */
function BubbleSnapshot({ node }: { node: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const clone = node.cloneNode(true) as HTMLElement
    // Ширину задаёт снимок (она измерена у оригинала): `max-w-[75%]` внутри клона считался бы
    // от ширины оверлея, и пузырь стал бы шире, чем был под пальцем.
    clone.style.maxWidth = 'none'
    clone.style.width = '100%'
    clone.style.transform = ''
    clone.removeAttribute('id')
    el.replaceChildren(clone)
  }, [node])

  return <div ref={host} aria-hidden />
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

/** Раскладка мобильного меню: куда встали снимок пузыря, пилюля реакций и карточка действий. */
interface Placement {
  bubbleTop: number
  bubbleHeight: number
  pillTop: number
  cardTop: number
}

// Блок взаимодействия с сообщением (Telegram-стиль): затемнение фона + быстрый ряд реакций и действия.
// Десктоп — компактное меню у точки (правый клик/шеврон).
//
// Телефон — не нижний лист, а меню у самого пузыря: фон размывается, снимок сообщения остаётся
// чётким на своём месте, над ним всплывает пилюля реакций, под ним — карточка действий. Нижний
// лист отрывал действия от сообщения (палец на одном краю экрана, сообщение на другом) и закрывал
// собой переписку; здесь связь «что именно я держу» не теряется. Лист остался ровно под полным
// emoji-пикером: там нужен весь экран, и он не привязан к месту нажатия.
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
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useBodyScrollLock()

  // ── Мобильная раскладка вокруг пузыря ───────────────────────────────────────
  const pillRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Placement | null>(null)
  // Сдвиг снимка от исходного места: сообщение у края экрана уезжает, освобождая место
  // реакциям и действиям, — но уезжает плавно, а не телепортируется.
  const [lift, setLift] = useState(0)

  const anchorTop = anchor?.rect.top ?? y
  const anchorHeight = anchor?.rect.height ?? 0

  useLayoutEffect(() => {
    if (pickerOpen) return
    const pill = pillRef.current
    const card = cardRef.current
    if (!pill || !card) return
    const pillH = pill.offsetHeight
    const cardH = card.offsetHeight
    // На ПК мобильный слой скрыт (display:none) — мерить нечего, раскладка не нужна.
    if (!pillH || !cardH) return

    const vh = window.innerHeight
    const free = vh - 2 * EDGE - pillH - cardH - 2 * GAP
    const bubbleHeight = Math.min(anchorHeight, Math.max(free, MIN_BUBBLE))
    const minTop = EDGE + pillH + GAP
    const maxTop = Math.max(minTop, vh - EDGE - cardH - GAP - bubbleHeight)
    const bubbleTop = Math.min(Math.max(anchorTop, minTop), maxTop)

    setPlace({
      bubbleTop,
      bubbleHeight,
      pillTop: bubbleTop - GAP - pillH,
      cardTop: bubbleTop + bubbleHeight + GAP,
    })
  }, [anchorTop, anchorHeight, pickerOpen])

  useEffect(() => {
    if (!place) return
    const delta = place.bubbleTop - anchorTop
    if (delta === 0 || prefersReducedMotion()) {
      setLift(delta)
      return
    }
    // Кадр задержки обязателен: если поставить конечное значение в том же кадре, что и
    // начальное, браузеру не между чем интерполировать — переход просто не запустится.
    const id = requestAnimationFrame(() => setLift(delta))
    return () => cancelAnimationFrame(id)
  }, [place, anchorTop])

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

  const actionsList = (variant: 'menu' | 'card'): React.ReactNode => (
    <div className="py-1">
      {items.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            onClick={run(it.onClick)}
            className={cn(
              'flex w-full cursor-pointer items-center text-left transition-colors hover:bg-muted',
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
      })}
    </div>
  )

  const reactAndClose = (emoji: string): void => {
    actions.onReact(emoji)
    onClose()
  }

  return (
    <div
      // Маркер для глобального Esc (shared/lib/use-escape-back).
      data-overlay
      className="fixed inset-0 z-50 bg-overlay/40 backdrop-blur-sm duration-150 animate-in fade-in md:bg-transparent md:backdrop-blur-none"
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
          onClose={onClose}
        />
      ) : (
        <div className="absolute inset-0 md:hidden">
          {anchor && (
            <div
              className="absolute overflow-y-auto overscroll-contain touch-pan-y"
              style={{
                left: anchor.rect.left,
                top: anchor.rect.top,
                width: anchor.rect.width,
                maxHeight: place?.bubbleHeight,
                transform: lift ? `translateY(${lift}px)` : undefined,
                transition: prefersReducedMotion()
                  ? undefined
                  : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <BubbleSnapshot node={anchor.node} />
            </div>
          )}
          {/* Обёртки во всю ширину только позиционируют — тап мимо плашки должен закрывать меню,
              поэтому события ловит не обёртка, а сама плашка. */}
          <div
            ref={pillRef}
            style={{ top: place?.pillTop ?? -9999 }}
            className={cn(
              'pointer-events-none absolute inset-x-3 flex',
              mine ? 'justify-end' : 'justify-start',
            )}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'pointer-events-auto max-w-full duration-200 animate-in fade-in zoom-in-95',
                mine ? 'origin-bottom-right' : 'origin-bottom-left',
              )}
            >
              <ReactionsRow
                variant="pill"
                onReact={reactAndClose}
                onOpenPicker={() => setPickerOpen(true)}
                pickerLabel={t('emoji')}
              />
            </div>
          </div>
          <div
            ref={cardRef}
            style={{ top: place?.cardTop ?? -9999 }}
            className={cn(
              'pointer-events-none absolute inset-x-3 flex',
              mine ? 'justify-end' : 'justify-start',
            )}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'pointer-events-auto w-60 max-w-full overflow-hidden rounded-2xl border border-border bg-popover/95 shadow-xl backdrop-blur-md duration-200 animate-in fade-in zoom-in-95',
                mine ? 'origin-top-right' : 'origin-top-left',
              )}
            >
              {actionsList('card')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
