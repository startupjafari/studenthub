'use client'

import { useEffect, useRef, useState } from 'react'
import { MOTION, prefersReducedMotion } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

/**
 * Правая колонка чата (Telegram-стиль): профиль собеседника или группы и общие материалы.
 *
 * Два режима, как у Telegram Web:
 *  · широкое окно (≥1280 px) — колонка встаёт рядом с перепиской и сжимает её. Ширина
 *    колонки едет вместе с содержимым, а само содержимое прижато к правому краю: панель
 *    выезжает из-за края окна, а не «проявляется» шторкой слева направо;
 *  · узкое окно — панель поверх переписки: на планшете островом справа (переписка остаётся
 *    видна слева), на телефоне — во весь экран. Въезд и уход — сдвигом от правого края.
 *
 * Ширина в широком окне — четверть экрана в пределах 20–26.5 rem: в 1280 px переписке
 * остаётся место, а на большом мониторе колонка не превращается в полосу.
 */
const DOCKED_WIDTH = 'w-[clamp(20rem,25vw,26.5rem)]'

export function RightColumn({
  open,
  wide,
  children,
}: {
  /** Панель показана. Закрытие проигрывается до конца, прежде чем панель уйдёт из DOM. */
  open: boolean
  /** Широкое окно: колонка рядом с перепиской, а не поверх неё. */
  wide: boolean
  /** Содержимое; null — открытого чата нет (панель уезжает с последним показанным). */
  children: React.ReactNode | null
}) {
  // Последнее непустое содержимое: если чат пропал (покинули группу), панель всё равно
  // уезжает с ним, а не схлопывается пустым прямоугольником.
  const last = useRef<React.ReactNode | null>(children)
  if (children) last.current = children
  const shown = open && children != null

  if (wide) {
    return (
      <aside
        className={cn(
          'hidden shrink-0 justify-end overflow-hidden transition-[width] duration-(--motion-panel) motion-reduce:transition-none xl:flex',
          shown ? cn(DOCKED_WIDTH, 'border-l border-border') : 'w-0',
        )}
        aria-hidden={!shown}
        // Уехавшая колонка остаётся в DOM (её ширина анимируется), но фокус в неё попадать
        // не должен: Tab иначе уводил бы в невидимые кнопки.
        inert={!shown}
      >
        {last.current && <div className={cn('h-full shrink-0', DOCKED_WIDTH)}>{last.current}</div>}
      </aside>
    )
  }
  return <OverlayColumn open={shown}>{last.current}</OverlayColumn>
}

/** Панель поверх переписки: монтируется на открытие и доигрывает уход перед размонтированием. */
function OverlayColumn({ open, children }: { open: boolean; children: React.ReactNode | null }) {
  const [present, setPresent] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setPresent(true)
      setClosing(false)
      return
    }
    if (prefersReducedMotion()) {
      setPresent(false)
      return
    }
    setClosing(true)
    const id = window.setTimeout(() => {
      setPresent(false)
      setClosing(false)
    }, MOTION.panel)
    return () => window.clearTimeout(id)
  }, [open])

  if (!present || !children) return null
  return (
    <div
      className={cn(
        // Телефон — весь экран; с md — остров справа поверх переписки (как Telegram в
        // среднем окне): тень и граница, потому что слой парит над содержимым.
        'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background duration-(--motion-panel) md:w-[26.5rem] md:border-l md:border-border md:shadow-lg',
        closing
          ? 'pointer-events-none animate-out fade-out-0 slide-out-to-right fill-mode-forwards'
          : 'animate-in slide-in-from-right',
      )}
    >
      {children}
    </div>
  )
}
