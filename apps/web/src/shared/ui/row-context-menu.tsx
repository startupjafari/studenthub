'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useBodyScrollLock } from '../lib/use-body-scroll-lock'
import { useSheetDragClose } from '../lib/use-sheet-drag-close'
import { cn } from '../lib/utils'

export interface RowContextMenuItem {
  key: string
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
}

/**
 * Действия над строкой списка — по правому клику (ПК) и долгому нажатию (тач).
 *
 * Раньше и в чатах, и в уведомлениях их прятала кнопка «три точки», всплывавшая по
 * наведению поверх правого края строки: она наезжала на время и счётчик непрочитанных,
 * а на тач-экране не появлялась вовсе. Правый клик — тот же контракт, что у меню
 * сообщения (`entities/chat/message-context-menu`): меню у точки на десктопе, нижний
 * лист на телефоне.
 *
 * Строку, к которой относится меню, вызывающий экран обязан подсветить на всё время его
 * жизни — иначе в длинном списке непонятно, над чем сейчас действие. Подсветка снаружи,
 * а не здесь: меню не знает, как выглядит строка и что у неё уже за фон (активная,
 * непрочитанная).
 */
export function RowContextMenu({
  x,
  y,
  items,
  ariaLabel,
  onClose,
}: {
  x: number
  y: number
  items: RowContextMenuItem[]
  ariaLabel: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

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
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const sheetRef = useSheetDragClose<HTMLDivElement>(onClose)
  useBodyScrollLock()

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const list = (variant: 'menu' | 'sheet'): React.ReactNode =>
    items.map((it) => {
      const Icon = it.icon
      return (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          onClick={run(it.onClick)}
          className={cn(
            'flex w-full cursor-pointer items-center text-left transition-colors hover:bg-muted',
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
    })

  return (
    <div
      className="fixed inset-0 z-50 bg-overlay/40 duration-150 animate-in fade-in md:bg-transparent"
      role="menu"
      aria-label={ariaLabel}
      onClick={onClose}
      onContextMenu={(e) => {
        // Второй правый клик закрывает меню, а не открывает системное поверх него.
        e.preventDefault()
        onClose()
      }}
    >
      {/* ПК: меню у точки нажатия. */}
      <div
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onClick={(e) => e.stopPropagation()}
        className="absolute hidden w-52 overflow-hidden rounded-2xl border border-border bg-popover py-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 md:block"
      >
        {list('menu')}
      </div>

      {/* Телефон: нижний лист, закрывается свайпом вниз — как меню сообщения. */}
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-popover pb-[env(safe-area-inset-bottom)] shadow-lg duration-200 animate-in slide-in-from-bottom md:hidden"
      >
        <div
          className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30"
          aria-hidden
        />
        <div className="py-1">{list('sheet')}</div>
      </div>
    </div>
  )
}
