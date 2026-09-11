'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMediaQuery } from 'shared/lib/use-media-query'
import { useScrollRow } from 'shared/lib/use-scroll-row'
import { cn } from 'shared/lib/utils'

// Переключатель разделов страницы для шапки (PageHeader). Раньше каждый экран
// собирал такие табы вручную: контейнер `bg-muted/50` + активная вкладка сплошным
// `bg-primary` — тяжёлый синий блок внутри шапки. Здесь единый компонент в том же
// визуальном языке, что пункты сайдбара: подсветка активного `bg-primary/10 text-primary`,
// неактивные — приглушённые, без обводки-контейнера.
//
// Ряд не влезает в телефон почти никогда не в одиночку: у него два режима.
//  · Влезает или почти влезает — дорожка с прокруткой: тянется пальцем (нативно) и мышью
//    (`useScrollRow`), у краёв затухание «есть ещё», активный таб сам подъезжает в видимую
//    зону после смены значения.
//  · Узкий экран и ряд шире дорожки — сворачивается в один селектор: строка с текущим
//    разделом, по нажатию список разделов приходит островом над нижней навигацией (там же,
//    где меню «Ещё»). Искать раздел перетаскиванием 44-пиксельной полосы — работа, которой
//    не должно быть.

/** Уже этого выбор из списка честнее прокрутки: в дорожку влезает два-три чипа. */
const COLLAPSE_QUERY = '(max-width: 25rem)'

export interface SegmentedTabItem<T extends string> {
  value: T
  label: ReactNode
  /** Счётчик справа от подписи (например число новых жалоб). 0 не показывается. */
  count?: number
  icon?: LucideIcon
}

export interface SegmentedTabsProps<T extends string> {
  items: readonly SegmentedTabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** Доступное имя группы переключателей. */
  'aria-label'?: string
  /**
   * Сворачивать ряд в селектор на узком экране. Выключать там, где ряда всё равно два
   * пункта или где список обязан быть виден целиком.
   */
  collapsible?: boolean
  className?: string
}

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  'aria-label': ariaLabel,
  collapsible = true,
  className,
}: SegmentedTabsProps<T>) {
  const row = useScrollRow<HTMLDivElement>()
  const { reveal } = row
  const narrow = useMediaQuery(COLLAPSE_QUERY)
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // «Ряд не влез» запоминаем: в свёрнутом виде мерить уже нечего, а решение должно быть
  // устойчивым — иначе селектор и дорожка мигали бы друг в друга.
  const [tooWide, setTooWide] = useState(false)
  useEffect(() => {
    if (row.overflowing) setTooWide(true)
  }, [row.overflowing])

  const collapsed = collapsible && narrow && tooWide
  const active = items.find((item) => item.value === value)

  // Активный раздел не остаётся за обрезом: после смены значения (в том числе из селектора)
  // дорожка подвозит его в видимую зону.
  useEffect(() => {
    if (!collapsed) reveal(activeRef.current)
  }, [value, collapsed, reveal])

  useEffect(() => {
    if (!menuOpen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  function countPill(isActive: boolean): string {
    return cn(
      'shrink-0 rounded-full px-1.5 py-px text-center text-[0.6875rem] font-semibold tabular-nums',
      isActive ? 'bg-primary/15 text-primary' : 'bg-foreground/10 text-muted-foreground',
    )
  }

  if (collapsed) {
    const ActiveIcon = active?.icon
    return (
      <div role="group" aria-label={ariaLabel} className={cn('min-w-0', className)}>
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-2xl border border-border bg-muted/50 px-3.5 text-sm font-medium transition-colors"
        >
          {ActiveIcon && <ActiveIcon className="size-4 shrink-0" aria-hidden />}
          <span className="min-w-0 truncate">{active?.label}</span>
          {!!active?.count && (
            <span className={countPill(true)}>{active.count > 99 ? '99+' : active.count}</span>
          )}
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>

        {menuOpen &&
          typeof document !== 'undefined' &&
          createPortal(
            <>
              {/* Ловушка нажатий: список закрывается тапом мимо, без затемнения — он
                  поповер, а не модальный лист. */}
              <div className="fixed inset-0 z-[199]" onClick={() => setMenuOpen(false)} />
              {/* Остров над нижней навигацией — то же место и тот же материал, что у меню
                  «Ещё». Слой как у `DropdownMenu` (§5.3): селектор открывается и из шапки
                  страницы, и из модалки. */}
              <div
                className={cn(
                  'material-island fixed inset-x-3 bottom-[calc(var(--bottom-nav-offset)+var(--kb-inset,0px))] z-[200]',
                  'flex max-h-[min(60dvh,24rem)] flex-col overflow-y-auto overscroll-contain',
                  'rounded-3xl border border-border/60 p-1.5 shadow-lg',
                  'origin-bottom duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-1 motion-reduce:animate-none',
                )}
              >
                {items.map((item) => {
                  const isActive = item.value === value
                  const Icon = item.icon
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => {
                        setMenuOpen(false)
                        onChange(item.value)
                      }}
                      className={cn(
                        'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium transition-colors hover:bg-foreground/[0.06] active:bg-foreground/[0.09]',
                        isActive && 'bg-primary/10 text-primary',
                      )}
                    >
                      {Icon && <Icon className="size-5 shrink-0 opacity-80" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {!!item.count && (
                        <span className={countPill(isActive)}>
                          {item.count > 99 ? '99+' : item.count}
                        </span>
                      )}
                      {isActive && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            </>,
            document.body,
          )}
      </div>
    )
  }

  return (
    <div
      ref={row.ref}
      role="group"
      aria-label={ariaLabel}
      // Список может не влезть в узкий экран — прокрутка без видимой полосы, зато с
      // затуханием у краёв и перетаскиванием (см. useScrollRow).
      className={cn(
        'flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-muted/50 p-1 lg:rounded-xl',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        row.overflowing && 'cursor-grab',
        row.dragging && 'cursor-grabbing select-none',
        className,
      )}
      style={{ maskImage: row.fadeMask, WebkitMaskImage: row.fadeMask }}
    >
      {items.map((item) => {
        const isActive = item.value === value
        const Icon = item.icon
        return (
          <button
            key={item.value}
            ref={isActive ? activeRef : undefined}
            type="button"
            // aria-pressed, а не role="tab": это фильтр-переключатель, а связанной
            // tabpanel-области с id здесь нет — неполная tab-семантика хуже честной кнопки.
            aria-pressed={isActive}
            onClick={() => onChange(item.value)}
            className={cn(
              // 44 px под палец (§13) и компактные 32 px там, где курсор: одна и та же
              // строка табов служит и шапкой мобильного экрана, и фильтром на десктопе.
              'flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/20 lg:min-h-8 lg:rounded-lg lg:px-3',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {item.label}
            {!!item.count && (
              <span className={countPill(isActive)}>{item.count > 99 ? '99+' : item.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
