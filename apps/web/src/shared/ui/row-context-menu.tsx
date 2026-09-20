'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { useBodyScrollLock } from '../lib/use-body-scroll-lock'
import { useSheetDragClose } from '../lib/use-sheet-drag-close'
import { cn } from '../lib/utils'

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
 * сообщения (`entities/chat/message-context-menu`): меню у точки на десктопе, нижний
 * лист на телефоне.
 *
 * Строку, к которой относится меню, вызывающий экран обязан подсветить на всё время его
 * жизни — иначе в длинном списке непонятно, над чем сейчас действие. Подсветка снаружи,
 * а не здесь: меню не знает, как выглядит строка и что у неё уже за фон (активная,
 * непрочитанная).
 *
 * Вложенный список (`items`) раскрывается на месте — тем же полотном, с заголовком-возвратом,
 * а не вылетающей вбок панелью: на телефоне лететь некуда, а два разных поведения на ПК и на
 * телефоне пришлось бы объяснять пользователю дважды.
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
  // Открытый вложенный список. Хранится ключом, а не ссылкой на пункт: массив пунктов
  // приходит заново на каждый рендер родителя, и по ключу галочки внутри обновляются
  // сразу после действия, не закрывая меню.
  const [openKey, setOpenKey] = useState<string | null>(null)

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
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const sheetRef = useSheetDragClose<HTMLDivElement>(onClose)
  useBodyScrollLock()

  const run = (it: RowContextMenuItem) => () => {
    if (it.items) {
      setOpenKey(it.key)
      return
    }
    it.onClick?.()
    if (!it.keepOpen) onClose()
  }

  const open = openKey ? items.find((it) => it.key === openKey) : undefined
  const shown = open?.items ?? items

  const list = (variant: 'menu' | 'sheet'): React.ReactNode => (
    <>
      {open && (
        <button
          type="button"
          onClick={() => setOpenKey(null)}
          className={cn(
            'flex w-full cursor-pointer items-center border-b border-border text-left font-medium text-foreground transition-colors hover:bg-muted',
            variant === 'sheet' ? 'gap-3 px-4 py-3 text-base' : 'gap-2 px-3 py-2 text-sm',
          )}
        >
          <ChevronLeft
            className={cn('shrink-0 opacity-80', variant === 'sheet' ? 'size-5' : 'size-4')}
            aria-hidden
          />
          <span className="truncate">{open.label}</span>
        </button>
      )}
      {shown.map((it) => {
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
              'flex w-full cursor-pointer items-center text-left transition-colors hover:bg-muted',
              variant === 'sheet' ? 'gap-3 px-4 py-3 text-base' : 'gap-2 px-3 py-2 text-sm',
              it.danger ? 'text-destructive' : 'text-foreground',
            )}
          >
            <Icon
              className={cn('shrink-0 opacity-80', variant === 'sheet' ? 'size-5' : 'size-4')}
              aria-hidden
            />
            <span className="truncate">{it.label}</span>
            {it.items && (
              <ChevronRight className="ml-auto size-4 shrink-0 opacity-60" aria-hidden />
            )}
            {it.checked && <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden />}
          </button>
        )
      })}
    </>
  )

  return (
    <div
      // Маркер для глобального Esc (shared/lib/use-escape-back).
      data-overlay
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
        className="absolute hidden max-h-[70vh] w-56 overflow-y-auto rounded-2xl border border-border bg-popover py-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 md:block"
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
