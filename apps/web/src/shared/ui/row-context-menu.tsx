'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { useBodyScrollLock } from '../lib/use-body-scroll-lock'
import { useDismissAnimation } from '../lib/use-dismiss-animation'
import { cn } from '../lib/utils'
import { AnchoredMenuLayer, MENU_EXIT_MS, type MenuAnchor } from './anchored-menu'
import { MenuSeparator, splitDanger } from './menu-separator'

export interface RowContextMenuItem {
  key: string
  label: string
  icon: LucideIcon
  onClick?: () => void
  danger?: boolean
  /** Пункт раскрывает вложенный список прямо в меню (папки чата), а не действует сам. */
  items?: RowContextMenuItem[]
  /** Галочка справа: пункт показывает состояние, а не только действие. */
  checked?: boolean
  /** Не закрывать меню после нажатия — переключатель, который жмут несколько раз подряд. */
  keepOpen?: boolean
}

/**
 * Действия над строкой списка — по правому клику (ПК) и долгому нажатию (тач).
 *
 * Раньше и в чатах, и в уведомлениях их прятала кнопка «три точки», всплывавшая по
 * наведению поверх правого края строки: она наезжала на время и счётчик непрочитанных,
 * а на тач-экране не появлялась вовсе. Правый клик — тот же контракт, что у меню
 * сообщения (`entities/chat/message-context-menu`): меню у точки на десктопе, меню у самой
 * строки на телефоне.
 *
 * На телефоне строка поднимается снимком над размытым фоном, а действия растут прямо под ней
 * (`AnchoredMenuLayer`) — как в Telegram. Нижний лист, который был здесь раньше, отрывал
 * действия от строки: в длинном списке к моменту открытия листа было уже не видно, какой
 * именно чат сейчас удаляют.
 *
 * Строку, к которой относится меню, вызывающий экран обязан подсветить на всё время его
 * жизни — по той же причине. Подсветка снаружи, а не здесь: меню не знает, как выглядит
 * строка и что у неё уже за фон (активная, непрочитанная).
 *
 * Вложенный список (`items`) раскрывается на месте — тем же полотном, с заголовком-возвратом,
 * а не вылетающей вбок панелью: на телефоне лететь некуда, а два разных поведения на ПК и на
 * телефоне пришлось бы объяснять пользователю дважды.
 */
export function RowContextMenu({
  x,
  y,
  anchor,
  items,
  ariaLabel,
  onClose,
}: {
  x: number
  y: number
  /** Строка под пальцем — есть только у долгого нажатия (тач). */
  anchor?: MenuAnchor | null
  items: RowContextMenuItem[]
  ariaLabel: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // Открытый вложенный список. Хранится ключом, а не ссылкой на пункт: массив пунктов
  // приходит заново на каждый рендер родителя, и по ключу галочки внутри обновляются
  // сразу после действия, не закрывая меню.
  const [openKey, setOpenKey] = useState<string | null>(null)
  // Меню не исчезает кадром: сначала уход, потом размонтирование родителем.
  const { closing, dismiss } = useDismissAnimation(onClose, MENU_EXIT_MS)

  // Меню не вылезает за вьюпорт: у нижних строк длинного списка точка нажатия близка
  // к нижнему краю, и без сдвига половина пунктов оказалась бы за экраном.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (!width || !height) return
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    })
    // `openKey` в зависимостях: вложенный список выше или ниже корневого, и без пересчёта
    // раскрытые папки уезжали бы за нижний край экрана.
  }, [x, y, openKey])

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

  const run = (it: RowContextMenuItem) => () => {
    if (it.items) {
      setOpenKey(it.key)
      return
    }
    it.onClick?.()
    if (!it.keepOpen) dismiss()
  }

  const open = openKey ? items.find((it) => it.key === openKey) : undefined
  const shown = open?.items ?? items

  const list = (variant: 'menu' | 'card'): React.ReactNode => {
    const row = (it: RowContextMenuItem): React.ReactNode => {
      const Icon = it.icon
      return (
        <button
          key={it.key}
          type="button"
          role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={it.checked}
          aria-haspopup={it.items ? 'menu' : undefined}
          onClick={run(it)}
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
          {it.items && <ChevronRight className="ml-auto size-4 shrink-0 opacity-60" aria-hidden />}
          {it.checked && <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden />}
        </button>
      )
    }
    // Опасные пункты — всегда в конце и за линией (см. MenuSeparator).
    const { safe, danger } = splitDanger(shown)
    return (
      <>
        {open && (
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            className={cn(
              'flex w-full cursor-pointer items-center border-b border-border text-left font-medium text-foreground transition-colors hover:bg-muted active:bg-muted',
              variant === 'card' ? 'gap-3 px-4 py-2.5 text-[15px]' : 'gap-2 px-3 py-2 text-sm',
            )}
          >
            <ChevronLeft
              className={cn('shrink-0 opacity-80', variant === 'card' ? 'size-5' : 'size-4')}
              aria-hidden
            />
            <span className="truncate">{open.label}</span>
          </button>
        )}
        {safe.map(row)}
        {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
        {danger.map(row)}
      </>
    )
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
      aria-label={ariaLabel}
      onClick={dismiss}
      onContextMenu={(e) => {
        // Второй правый клик закрывает меню, а не открывает системное поверх него.
        e.preventDefault()
        dismiss()
      }}
    >
      {/* ПК: меню у точки нажатия. */}
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute hidden max-h-[70vh] w-56 overflow-y-auto rounded-2xl border border-border bg-popover py-1 shadow-lg duration-150 md:block',
          closing ? 'animate-out fade-out zoom-out-95' : 'animate-in fade-in zoom-in-95',
        )}
      >
        {list('menu')}
      </div>

      {/* Телефон: строка поднимается снимком, действия растут под ней. */}
      <AnchoredMenuLayer
        anchor={anchor}
        fallbackY={y}
        align="start"
        closing={closing}
        onBackdropTap={dismiss}
        snapshotClassName="rounded-2xl shadow-xl"
        card={<div className="py-1">{list('card')}</div>}
      />
    </div>
  )
}
