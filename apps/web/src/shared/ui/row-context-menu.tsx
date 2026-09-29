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
 * Вложенный список (`items`) на ПК — вторым меню сбоку, по наведению, как в Telegram Desktop:
 * папки чата видно сразу, не теряя из виду остальные действия, и отметить чат в нескольких
 * папках можно, не возвращаясь назад. На телефоне наводить нечем и лететь вбок некуда —
 * там список раскрывается на месте тем же полотном, с заголовком-возвратом.
 */

/** Ширина меню (w-56) — по ней второе меню встаёт вплотную к первому. */
const MENU_WIDTH = 224
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
  // ПК: второе меню сбоку — чей список и у какой строки оно стоит.
  const [fly, setFly] = useState<{ key: string; left: number; top: number } | null>(null)
  const flyRef = useRef<HTMLDivElement>(null)
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

  // Второе меню не вылезает за низ экрана: у нижних пунктов длинный список папок иначе
  // уходил бы за край. Сдвиг вверх — ровно на то, что не влезло.
  useLayoutEffect(() => {
    const el = flyRef.current
    if (!el || !fly) return
    const { height } = el.getBoundingClientRect()
    const top = Math.max(8, Math.min(fly.top, window.innerHeight - height - 8))
    if (top !== fly.top) setFly({ ...fly, top })
  }, [fly])

  /** Открыть второе меню у строки `row`: справа от меню, а не влезает — слева. */
  const openFly = (it: RowContextMenuItem, row: HTMLElement): void => {
    const menu = ref.current?.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (!menu) return
    const right = menu.right - 4
    const left = right + MENU_WIDTH > window.innerWidth - 8 ? menu.left - MENU_WIDTH + 4 : right
    // -4: первый пункт второго меню встаёт вровень со строкой, а не на отступ ниже.
    setFly({ key: it.key, left, top: r.top - 4 })
  }

  const run = (it: RowContextMenuItem) => () => {
    if (it.items) {
      setOpenKey(it.key)
      return
    }
    it.onClick?.()
    if (!it.keepOpen) dismiss()
  }

  // Раскрытие на месте — только у телефонного полотна. На ПК корень меню не меняется,
  // вложенный список живёт во втором меню (`fly`).
  const open = openKey ? items.find((it) => it.key === openKey) : undefined
  const flyItems = fly ? items.find((it) => it.key === fly.key)?.items : undefined

  const list = (variant: 'menu' | 'card' | 'fly'): React.ReactNode => {
    const drill = variant === 'card' ? open : undefined
    const shown = variant === 'fly' ? (flyItems ?? []) : (drill?.items ?? items)
    const card = variant === 'card'
    const row = (it: RowContextMenuItem): React.ReactNode => {
      const Icon = it.icon
      const parentOnDesktop = variant === 'menu' && !!it.items
      return (
        <button
          key={it.key}
          type="button"
          role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={it.checked}
          aria-haspopup={it.items ? 'menu' : undefined}
          aria-expanded={parentOnDesktop ? fly?.key === it.key : undefined}
          onClick={parentOnDesktop ? (e) => openFly(it, e.currentTarget as HTMLElement) : run(it)}
          // ПК: наведение на пункт с вложенным списком открывает второе меню, на любой
          // другой пункт корня — закрывает его, как в системных меню.
          onMouseEnter={
            variant === 'menu'
              ? (e) => {
                  if (it.items) openFly(it, e.currentTarget)
                  else setFly(null)
                }
              : undefined
          }
          className={cn(
            'flex w-full cursor-pointer items-center text-left transition-colors hover:bg-muted active:bg-muted',
            card ? 'gap-3 px-4 py-2.5 text-[15px]' : 'gap-2 px-3 py-2 text-sm',
            it.danger ? 'text-destructive' : 'text-foreground',
            parentOnDesktop && fly?.key === it.key && 'bg-muted',
          )}
        >
          <Icon className={cn('shrink-0 opacity-80', card ? 'size-5' : 'size-4')} aria-hidden />
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
        {drill && (
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            className="flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-left text-[15px] font-medium text-foreground transition-colors hover:bg-muted active:bg-muted"
          >
            <ChevronLeft className="size-5 shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{drill.label}</span>
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

      {/* ПК: второе меню — вложенный список сбоку от своего пункта. Вне первого меню, а
          не внутри: у того `overflow-y-auto`, и выехавшая вбок панель была бы обрезана. */}
      {fly && flyItems && (
        <div
          ref={flyRef}
          role="menu"
          aria-label={items.find((it) => it.key === fly.key)?.label}
          style={{ left: fly.left, top: fly.top }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'absolute hidden max-h-[70vh] w-56 overflow-y-auto rounded-2xl border border-border bg-popover py-1 shadow-lg duration-150 md:block',
            closing ? 'animate-out fade-out zoom-out-95' : 'animate-in fade-in zoom-in-95',
          )}
        >
          {list('fly')}
        </div>
      )}

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
