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
  EmojiPicker,
  MENU_EXIT_MS,
  MenuSeparator,
  splitDanger,
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

/**
 * Действия меню. Обязательны реакция, ответ и копирование — они есть у любой переписки.
 * Остальное — по месту: меню чата отдаёт всё, а переписки «как в чате» вне него (обсуждение
 * события, обращение в поддержку) — только то, что там бывает. Нет обработчика — нет пункта.
 */
export interface MessageMenuActions {
  onReact: (emoji: string) => void
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
  chosen,
  onReact,
  onOpenPicker,
  pickerLabel,
}: {
  /**
   * `pill` — плашка над пузырём (телефон), цели под палец; `menu` — плашка над меню у
   * курсора (ПК). Обе — отдельная пилюля над списком действий, как в Telegram.
   */
  variant?: 'menu' | 'pill'
  /** Эмодзи, которые я уже поставил: отмечены подложкой, нажатие их снимает. */
  chosen: ReadonlySet<string>
  onReact: (emoji: string) => void
  onOpenPicker: () => void
  pickerLabel: string
}) {
  const row = useScrollRow<HTMLDivElement>()
  const pill = variant === 'pill'
  const btn = cn(
    'flex shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-transform hover:scale-110 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-95',
    pill ? 'size-11' : 'size-10',
  )

  return (
    <div
      ref={row.ref}
      className={cn(
        'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Без своего backdrop-blur: размытие даёт затемнение под пилюлей, а второй фильтр
        // поверх первого на телефоне стоит кадров.
        'max-w-full rounded-full border border-border bg-popover px-1.5 py-1',
        pill ? 'shadow-xl' : 'shadow-lg',
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
      )}
      style={{ maskImage: row.fadeMask, WebkitMaskImage: row.fadeMask }}
    >
      <div className="mx-auto flex w-max items-center gap-0.5">
        {CHAT_REACTION_EMOJIS.map((emoji, i) => (
          <button
            key={emoji}
            type="button"
            aria-pressed={chosen.has(emoji)}
            onClick={() => onReact(emoji)}
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
          </button>
        ))}
        {/* §11: развернуть полный набор — реакция любым emoji (стрелка вниз, как в Telegram). */}
        <button
          type="button"
          aria-label={pickerLabel}
          title={pickerLabel}
          onClick={onOpenPicker}
          className={cn(btn, 'text-muted-foreground')}
        >
          <ChevronDown className={pill ? 'size-6' : 'size-5'} aria-hidden />
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
}: {
  message: MessageMenuTarget
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

  const actionsList = (variant: 'menu' | 'card'): React.ReactNode => {
    const rowClass = (danger?: boolean): string =>
      cn(
        'flex w-full cursor-pointer items-center text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted active:bg-muted',
        variant === 'card' ? 'gap-3 px-4 py-2.5 text-[15px]' : 'gap-2 px-3 py-2 text-sm',
        danger ? 'text-destructive' : 'text-foreground',
      )
    const iconClass = cn('shrink-0 opacity-80', variant === 'card' ? 'size-5' : 'size-4')
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
    // Опасные пункты — всегда в конце и за линией (см. MenuSeparator).
    const { safe, danger } = splitDanger(items)
    return (
      <div className="py-1">
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
          <EmojiPicker searchPlaceholder={t('emojiSearch')} onPick={reactAndClose} />
        ) : (
          <>
            <ReactionsRow
              chosen={chosen}
              onReact={reactAndClose}
              onOpenPicker={() => setPickerOpen(true)}
              pickerLabel={t('tgBehavior.moreReactions')}
            />
            <div className="w-64 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg">
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
            <EmojiPicker
              className="w-full"
              searchPlaceholder={t('emojiSearch')}
              onPick={reactAndClose}
            />
          ) : (
            <ReactionsRow
              variant="pill"
              chosen={chosen}
              onReact={reactAndClose}
              onOpenPicker={() => setPickerOpen(true)}
              pickerLabel={t('tgBehavior.moreReactions')}
            />
          )
        }
        card={pickerOpen ? null : actionsList('card')}
      />
    </div>
  )
}
