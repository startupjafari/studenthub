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
  // Вложенный список выезжает вправо, но у правого края экрана места нет — тогда влево.
  const [flipSub, setFlipSub] = useState(false)
  // Меню не исчезает кадром: сначала уход, потом размонтирование родителем.
  const { closing, dismiss } = useDismissAnimation(onClose, MENU_EXIT_MS)

  // Меню не вылезает за вьюпорт: у нижних строк длинного списка точка нажатия близка
  // к нижнему краю, и без сдвига половина пунктов оказалась бы за экраном.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (!width || !height) return
    const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
    setPos({ left, top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) })
    // Ширина вложенной панели та же (w-56 = 224px) плюс отступ между ними.
    setFlipSub(left + width + 228 > window.innerWidth)
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

  const row = (
    it: RowContextMenuItem,
    variant: 'menu' | 'card',
    onMouseEnter?: () => void,
  ): React.ReactNode => {
    const Icon = it.icon
    return (
      <button
        key={it.key}
        type="button"
        role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={it.checked}
        aria-haspopup={it.items ? 'menu' : undefined}
        aria-expanded={it.items ? openKey === it.key : undefined}
        onMouseEnter={onMouseEnter}
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

  /**
   * ПК: вложенный список выезжает сбоку по наведению и убирается, как только курсор ушёл.
   *
   * Раньше он раскрывался на месте, полотном поверх корневого, и возвращаться приходилось
   * кнопкой-заголовком: на мыши это два лишних клика там, где хватает одного движения.
   * Панель — потомок строки в DOM, поэтому переход курсора со строки на неё не считается
   * уходом и список не схлопывается под рукой.
   */
  const parentRow = (it: RowContextMenuItem): React.ReactNode => (
    <div key={it.key} className="relative" onMouseEnter={() => setOpenKey(it.key)}>
      {row(it, 'menu')}
      {openKey === it.key && it.items && (
        <div
          role="menu"
          aria-label={it.label}
          className={cn(
            'absolute top-0 z-10 max-h-[60vh] w-56 overflow-y-auto rounded-2xl border border-border bg-popover py-1 shadow-lg duration-150 animate-in fade-in zoom-in-95',
            flipSub ? 'right-full mr-1 origin-top-right' : 'left-full ml-1 origin-top-left',
          )}
        >
          {it.items.map((sub) => row(sub, 'menu'))}
        </div>
      )}
    </div>
  )

  // Опасные пункты — всегда в конце и за линией (см. MenuSeparator).
  const menuList = (): React.ReactNode => {
    const { safe, danger } = splitDanger(items)
    const render = (it: RowContextMenuItem): React.ReactNode =>
      it.items ? parentRow(it) : row(it, 'menu', () => setOpenKey(null))
    return (
      <>
        {safe.map(render)}
        {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
        {danger.map(render)}
      </>
    )
  }

  // Телефон: наведения нет, поэтому вложенный список по-прежнему раскрывается на месте —
  // тем же полотном и с заголовком-возвратом. Лететь вбок на узком экране некуда.
  const cardList = (): React.ReactNode => {
    const { safe, danger } = splitDanger(open?.items ?? items)
    const render = (it: RowContextMenuItem): React.ReactNode => row(it, 'card')
    return (
      <>
        {open && (
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            className="flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-left text-[15px] font-medium text-foreground transition-colors hover:bg-muted active:bg-muted"
          >
            <ChevronLeft className="size-5 shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{open.label}</span>
          </button>
        )}
        {safe.map(render)}
        {safe.length > 0 && danger.length > 0 && <MenuSeparator />}
        {danger.map(render)}
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
        onMouseLeave={() => setOpenKey(null)}
        className={cn(
          'absolute hidden max-h-[70vh] w-56 rounded-2xl border border-border bg-popover py-1 shadow-lg duration-150 md:block',
          // Своя прокрутка обрезала бы выехавший вбок список. Пока он открыт, её нет:
          // меню короткое, а его высота и так ограничена max-h.
          openKey ? 'overflow-visible' : 'overflow-y-auto',
          closing ? 'animate-out fade-out zoom-out-95' : 'animate-in fade-in zoom-in-95',
        )}
      >
        {menuList()}
      </div>

      {/* Телефон: строка поднимается снимком, действия растут под ней. */}
      <AnchoredMenuLayer
        anchor={anchor}
        fallbackY={y}
        align="start"
        closing={closing}
        onBackdropTap={dismiss}
        snapshotClassName="rounded-2xl shadow-xl"
        card={<div className="py-1">{cardList()}</div>}
      />
    </div>
  )
}
