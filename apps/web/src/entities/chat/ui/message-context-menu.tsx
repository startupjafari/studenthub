'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  CheckCheck,
  ChevronDown,
  Copy,
  Flag,
  Forward,
  Heart,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { CHAT_REACTION_EMOJIS, MESSAGE_EDIT_WINDOW_MS } from '@studenthub/shared-config'
import {
  AnchoredMenuLayer,
  Avatar,
  AvatarFallback,
  AvatarImage,
  MENU_EXIT_MS,
  MenuSeparator,
  type MenuAnchor,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  staggerDelay,
  useBodyScrollLock,
  useScrollRow,
  useDismissAnimation,
} from '../../../shared/lib'
import type { ChatMessage, MessageReaction } from '../model/types'
import { EmojiPanelPopover } from './emoji-panel-popover'

/**
 * Действия меню. Обязательны реакция, ответ и копирование — они есть у любой переписки.
 * Остальное — по месту: меню чата отдаёт всё, а переписки «как в чате» вне него (обсуждение
 * события, обращение в поддержку) — только то, что там бывает. Нет обработчика — нет пункта.
 */
export interface MessageMenuActions {
  /** `origin` — центр нажатого эмодзи: оттуда реакция вылетает к своему чипу (если умеют). */
  onReact: (emoji: string, origin?: { x: number; y: number }) => void
  onReply: () => void
  onCopy: () => void
  onEdit?: () => void
  onPin?: () => void
  onCopyLink?: () => void
  onForward?: () => void
  onDelete?: () => void
  onSelect?: () => void
  /** Пожаловаться на чужое сообщение. Нет — пункта нет (роль жалоб не подаёт). */
  onReport?: () => void
  /** Список отреагировавших (пункт «N реакций» с лицами, как в Telegram). Нет — пункта нет. */
  onShowReactors?: () => void
  /**
   * Сделать эмодзи своей быстрой реакцией (правый клик или долгое нажатие по нему в ряду).
   * Нет — жеста нет: быстрая реакция есть только у чатов.
   */
  onSetDefaultReaction?: (emoji: string) => void
}

/**
 * Что меню знает о сообщении: время (окно правки), закреп и пересылку — если они бывают;
 * реакции — чтобы отметить в ряду уже поставленные мной и показать «N реакций».
 */
export type MessageMenuTarget = Pick<ChatMessage, 'createdAt'> &
  Partial<Pick<ChatMessage, 'pinnedAt' | 'forwardedFromId'>> & {
    reactions?: readonly MessageReaction[]
  }

/** Сколько лиц показать в пункте «N реакций» (Telegram — до трёх). */
const REACTOR_FACES = 3

/** Долгое нажатие по эмодзи в ряду — сделать его быстрой реакцией (как удержание в Telegram). */
const SET_QUICK_HOLD_MS = 450

const centerOf = (el: Element): { x: number; y: number } => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
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
  emojis,
  chosen,
  quick,
  onReact,
  onSetQuick,
  quickHint,
  onOpenPicker,
  pickerLabel,
}: {
  /**
   * `pill` — плашка над пузырём (телефон), цели под палец; `menu` — плашка над меню у
   * курсора (ПК). Обе — отдельная пилюля над списком действий, как в Telegram.
   */
  variant?: 'menu' | 'pill'
  /** Эмодзи ряда по порядку: быстрая реакция — первой, как в Telegram. */
  emojis: readonly string[]
  /** Эмодзи, которые я уже поставил: отмечены подложкой, нажатие их снимает. */
  chosen: ReadonlySet<string>
  /** Своя быстрая реакция (двойной клик по сообщению) — отмечена точкой под значком. */
  quick?: string
  onReact: (emoji: string, origin?: { x: number; y: number }) => void
  /** Правый клик или удержание по эмодзи — сделать его быстрой реакцией. */
  onSetQuick?: (emoji: string) => void
  quickHint?: string
  onOpenPicker: () => void
  pickerLabel: string
}) {
  const row = useScrollRow<HTMLDivElement>()
  const pill = variant === 'pill'
  // Удержание пальцем: таймер и отметка «сработало», чтобы отпускание не поставило реакцию.
  const hold = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false })
  const clearHold = (): void => {
    if (hold.current.timer !== null) window.clearTimeout(hold.current.timer)
    hold.current.timer = null
  }
  useEffect(() => clearHold, [])
  const setQuick = (emoji: string): void => {
    if (!onSetQuick) return
    hold.current.fired = true
    clearHold()
    onSetQuick(emoji)
  }
  const btn = cn(
    'relative flex shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-transform hover:scale-110 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-95',
    pill ? 'size-11' : 'size-10',
  )

  return (
    <div
      ref={row.ref}
      className={cn(
        'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Размытие — только на ПК (как у карточки действий): на телефоне под пилюлей уже
        // размытое затемнение, а второй фильтр поверх первого стоит кадров.
        'max-w-full rounded-full border border-border bg-popover px-1.5 py-1 md:bg-popover/85 md:backdrop-blur-xl',
        pill ? 'shadow-xl' : 'shadow-lg',
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
      )}
      style={{ maskImage: row.fadeMask, WebkitMaskImage: row.fadeMask }}
    >
      <div className="mx-auto flex w-max items-center gap-0.5">
        {emojis.map((emoji, i) => (
          <button
            key={emoji}
            type="button"
            aria-pressed={chosen.has(emoji)}
            title={onSetQuick ? quickHint : undefined}
            onClick={(e) => {
              // Отпускание после удержания — это выбор быстрой реакции, а не сама реакция.
              if (hold.current.fired) {
                hold.current.fired = false
                return
              }
              onReact(emoji, centerOf(e.currentTarget))
            }}
            onContextMenu={
              onSetQuick
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    // Android шлёт contextmenu и на удержание — второй раз не выбираем.
                    if (hold.current.fired) return
                    setQuick(emoji)
                    // Сразу снимаем отметку: за правым кликом мыши click не последует.
                    hold.current.fired = false
                  }
                : undefined
            }
            onPointerDown={
              onSetQuick
                ? (e) => {
                    hold.current.fired = false
                    if (e.pointerType === 'mouse') return
                    clearHold()
                    hold.current.timer = window.setTimeout(() => setQuick(emoji), SET_QUICK_HOLD_MS)
                  }
                : undefined
            }
            onPointerUp={onSetQuick ? clearHold : undefined}
            onPointerLeave={onSetQuick ? clearHold : undefined}
            onPointerCancel={onSetQuick ? clearHold : undefined}
            // Эмодзи появляются волной слева направо (Telegram), задержка — общая шкала.
            style={{ animationDelay: `${staggerDelay(i)}ms`, animationFillMode: 'backwards' }}
            className={cn(
              btn,
              'duration-(--motion-menu) animate-in fade-in-0 zoom-in-50',
              chosen.has(emoji) && 'bg-primary/15 hover:bg-primary/20',
            )}
          >
            <span
              className={cn(
                'flex items-center justify-center overflow-hidden leading-none',
                pill ? 'text-2xl' : 'text-[22px]',
              )}
            >
              {emoji}
            </span>
            {emoji === quick && (
              <span
                className="pointer-events-none absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary"
                aria-hidden
              />
            )}
          </button>
        ))}
        {/* §11: развернуть полный набор — реакция любым emoji (стрелка вниз, как в Telegram). */}
        <button
          type="button"
          aria-label={pickerLabel}
          title={pickerLabel}
          onClick={onOpenPicker}
          className={cn(btn, 'ml-0.5 text-muted-foreground')}
        >
          {/* Стрелка — в своём кружке, как в Telegram: видно, что это кнопка, а не эмодзи. */}
          <span
            className={cn(
              'flex items-center justify-center rounded-full bg-muted',
              pill ? 'size-9' : 'size-8',
            )}
          >
            <ChevronDown className={pill ? 'size-5' : 'size-4'} aria-hidden />
          </span>
        </button>
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
  myId,
  x,
  y,
  anchor,
  onClose,
  actions,
  canDelete = mine,
  defaultReaction,
}: {
  message: MessageMenuTarget
  /** Своя быстрая реакция: стоит первой в ряду и отмечена точкой. Нет — порядок общий. */
  defaultReaction?: string
  mine: boolean
  /** Кто смотрит: по нему в ряду отмечены уже поставленные реакции. */
  myId?: string
  /** Удалить можно не только своё: организатор события снимает чужие комментарии. */
  canDelete?: boolean
  x: number
  y: number
  /** Пузырь под пальцем — есть только у долгого нажатия (тач). */
  anchor?: MessageMenuAnchor | null
  onClose: () => void
  actions: MessageMenuActions
}) {
  const t = useTranslations('Chats')
  const rootRef = useRef<HTMLDivElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // §11: полный emoji-picker для реакции (по стрелке в ряду быстрых реакций).
  const [pickerOpen, setPickerOpen] = useState(false)
  // Меню не исчезает кадром: сначала уход, потом размонтирование родителем.
  const { closing, dismiss } = useDismissAnimation(onClose, MENU_EXIT_MS)

  // Десктопное меню удерживаем в пределах вьюпорта (на мобильном оно скрыто — меню у пузыря).
  // `pickerOpen` в зависимостях: развёрнутый набор выше ряда, и без пересчёта он уезжал бы
  // за нижний край экрана.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (!width || !height) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
  }, [x, y, pickerOpen])

  // Пункты видимой копии меню: у ПК и телефона разметка своя, и скрытая медиазапросом
  // в обход стрелок не попадает.
  const menuItems = (): HTMLElement[] =>
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter(
      (el) => el.getClientRects().length > 0,
    )

  // Клавиатура (как у RowContextMenu): фокус на первом пункте при открытии — с клавиши меню
  // или Shift+F10 он иначе оставался бы на пузыре под затемнением; стрелки ходят по пунктам;
  // после закрытия фокус возвращается туда, откуда меню открыли.
  useEffect(() => {
    // Долгое нажатие (есть якорь) — фокус не трогаем: на телефоне его уход из поля ввода
    // и возврат обратно прятали и снова поднимали клавиатуру под открытым меню.
    if (anchor) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuItems()[0]?.focus({ preventScroll: true })
    return () => opener?.focus({ preventScroll: true })
    // Только при открытии: дальше фокусом управляют стрелки.
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
        return
      }
      // В развёрнутом наборе стрелки принадлежат его полю поиска и сетке.
      if (pickerOpen || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const all = menuItems()
      if (all.length === 0) return
      e.preventDefault()
      const at = all.indexOf(document.activeElement as HTMLElement)
      const next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? all.length - 1
            : e.key === 'ArrowDown'
              ? (at + 1) % all.length
              : (at - 1 + all.length) % all.length
      all[next]?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss, pickerOpen])

  // Второй аргумент — запрет выделения на всей странице: оверлей перетаскивают,
  // и без него браузер выделяет текст, лежащий ПОД ним (см. хук).
  useBodyScrollLock(true, true)

  const run = (fn: () => void) => () => {
    fn()
    dismiss()
  }

  const reactions = message.reactions ?? []
  const chosen = new Set(reactions.filter((r) => r.userId === myId).map((r) => r.emoji))
  // Лица последних отреагировавших — без повторов: один человек мог поставить несколько.
  const faces: MessageReaction['user'][] = []
  for (let i = reactions.length - 1; i >= 0 && faces.length < REACTOR_FACES; i -= 1) {
    const u = reactions[i]?.user
    if (u && !faces.some((f) => f.id === u.id)) faces.push(u)
  }
  const onShowReactors = reactions.length > 0 ? actions.onShowReactors : undefined

  // Пересланное — чужие слова под подписью «Переслано от X»: их не правят (сервер тоже откажет).
  const canEdit =
    mine &&
    !message.forwardedFromId &&
    Date.now() - new Date(message.createdAt).getTime() < MESSAGE_EDIT_WINDOW_MS
  const optional = (
    key: string,
    label: string,
    icon: LucideIcon,
    onClick: (() => void) | undefined,
    danger = false,
  ): ActionDef[] => (onClick ? [{ key, label, icon, onClick, danger }] : [])
  const items: ActionDef[] = [
    { key: 'reply', label: t('reply'), icon: Reply, onClick: actions.onReply },
    ...(canEdit ? optional('edit', t('edit'), Pencil, actions.onEdit) : []),
    ...optional(
      'pin',
      message.pinnedAt ? t('unpin') : t('pin'),
      message.pinnedAt ? PinOff : Pin,
      actions.onPin,
    ),
    { key: 'copy', label: t('copyText'), icon: Copy, onClick: actions.onCopy },
    ...optional('link', t('copyLink'), Link2, actions.onCopyLink),
    ...optional('forward', t('forward'), Forward, actions.onForward),
    ...optional('select', t('select'), CheckCheck, actions.onSelect),
    ...(!mine ? optional('report', t('report'), Flag, actions.onReport, true) : []),
    ...(canDelete ? optional('delete', t('delete'), Trash2, actions.onDelete, true) : []),
  ]

  // Действия как в Telegram: значок 20 px в цвет текста, строки со скруглённой подсветкой
  // внутри карточки, без линии перед опасными — «Удалить» выделен только красным и стоит
  // последним (порядок задаёт `items`).
  const actionsList = (variant: 'menu' | 'card'): React.ReactNode => {
    const rowClass = (danger?: boolean): string =>
      cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg text-left font-medium outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07] active:bg-foreground/[0.1]',
        variant === 'card' ? 'px-3 py-2.5 text-[15px]' : 'px-3 py-1.5 text-sm',
        danger ? 'text-destructive' : 'text-foreground',
      )
    const iconClass = 'size-5 shrink-0'
    const row = (it: ActionDef): React.ReactNode => {
      const Icon = it.icon
      return (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          onClick={run(it.onClick)}
          className={rowClass(it.danger)}
        >
          <Icon className={iconClass} aria-hidden />
          <span className="truncate">{it.label}</span>
        </button>
      )
    }
    return (
      <div className="p-1">
        {/* «N реакций» с лицами — сводка над действиями (в Telegram — тот же пункт меню). */}
        {onShowReactors && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={run(onShowReactors)}
              className={rowClass()}
            >
              <Heart className={iconClass} aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                {t('tgBehavior.reactorsTitle', { count: reactions.length })}
              </span>
              <span className="flex shrink-0 -space-x-1.5" aria-hidden>
                {faces.map((u) => (
                  <Avatar key={u.id} className="size-5 ring-2 ring-popover">
                    {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
                    <AvatarFallback className="text-[0.55rem]">
                      {(u.lastName[0] ?? '') + (u.firstName[0] ?? '')}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </span>
            </button>
            <MenuSeparator />
          </>
        )}
        {items.map(row)}
      </div>
    )
  }

  // Точка последнего нажатия в меню: эмодзи из полного набора вылетает отсюда — у пикера
  // нет своего узла под каждую клетку, который можно было бы измерить.
  const lastPress = useRef<{ x: number; y: number } | undefined>(undefined)
  const reactAndClose = (emoji: string, origin?: { x: number; y: number }): void => {
    actions.onReact(emoji, origin ?? lastPress.current)
    dismiss()
  }
  const setQuickAndClose = actions.onSetDefaultReaction
    ? (emoji: string): void => {
        actions.onSetDefaultReaction?.(emoji)
        dismiss()
      }
    : undefined
  // Быстрая реакция — первой, как в Telegram; не из общего набора — добавляется в начало.
  const rowEmojis: readonly string[] = defaultReaction
    ? [defaultReaction, ...CHAT_REACTION_EMOJIS.filter((e) => e !== defaultReaction)]
    : CHAT_REACTION_EMOJIS
  // Полный набор — та же панель, что в поле ввода: реакции чата сеткой сверху, ниже
  // «Часто используемые» и все разделы (Telegram).
  const fullPicker = (className: string): React.ReactNode => (
    <EmojiPanelPopover
      featured={rowEmojis}
      chosen={chosen}
      onPick={(e) => reactAndClose(e)}
      className={cn('rounded-2xl md:bg-popover/90 md:backdrop-blur-xl', className)}
    />
  )
  const rowProps = {
    emojis: rowEmojis,
    chosen,
    quick: defaultReaction,
    onReact: reactAndClose,
    onSetQuick: setQuickAndClose,
    quickHint: t('tgReactions.setQuickHint'),
    onOpenPicker: () => setPickerOpen(true),
    pickerLabel: t('tgBehavior.moreReactions'),
  }

  return (
    <div
      ref={rootRef}
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
      onPointerDownCapture={(e) => {
        lastPress.current = { x: e.clientX, y: e.clientY }
      }}
    >
      {/* Десктоп: у точки нажатия пилюля быстрых реакций, под ней отдельной карточкой —
          действия (Telegram). Стрелка в пилюле разворачивает полный набор на месте обоих. */}
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute hidden max-w-[calc(100vw-1rem)] flex-col items-start gap-2 duration-150 md:flex',
          closing ? 'animate-out fade-out zoom-out-95' : 'animate-in fade-in zoom-in-95',
        )}
      >
        {pickerOpen ? (
          fullPicker('h-[24rem] w-[22rem]')
        ) : (
          <>
            <ReactionsRow {...rowProps} />
            <div className="w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-lg md:bg-popover/85 md:backdrop-blur-xl">
              {actionsList('menu')}
            </div>
          </>
        )}
      </div>

      {/* Телефон: реакции и действия у самого пузыря. Полный пикер раскрывается ТАМ ЖЕ,
          на месте ряда быстрых реакций, — как в Telegram. Нижний лист во весь экран
          уводил выбор от сообщения: пузырь, к которому подбирают реакцию, оставался где-то
          наверху за затемнением, и связь между «выбираю» и «к чему» терялась. */}
      <AnchoredMenuLayer
        anchor={anchor}
        fallbackY={y}
        align={mine ? 'end' : 'start'}
        closing={closing}
        onBackdropTap={dismiss}
        above={
          pickerOpen ? (
            fullPicker('h-[min(50dvh,24rem)] w-full max-w-full')
          ) : (
            <ReactionsRow variant="pill" {...rowProps} />
          )
        }
        card={pickerOpen ? null : actionsList('card')}
      />
    </div>
  )
}
