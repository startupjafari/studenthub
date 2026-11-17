'use client'

import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Check, Mic, Send, Video } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

export type MainButtonMode = 'record' | 'send' | 'edit'
/** Что пишет кнопка в режиме записи: голосовое (микрофон) или кружок (камера). */
export type RecordKind = 'voice' | 'video'

/** Сколько держать палец на «Отправить», чтобы открылось меню способа отправки. */
const LONG_PRESS_MS = 400

/**
 * Главная кнопка поля ввода, как в Telegram: одна кнопка на месте, а значок меняется —
 * микрофон (или камера кружка), пока поле пустое, самолётик, когда есть что отправить,
 * галочка в режиме правки. Микрофон и камеру переключает короткое нажатие, правый клик или
 * клавиша меню; удержание пишет.
 * Значки лежат стопкой и меняются масштабом с прозрачностью; при сниженной анимации остаётся
 * только смена прозрачности.
 *
 * У «Отправить» есть меню способа отправки: правый клик на ПК, долгое нажатие на телефоне.
 */
export function ComposerMainButton({
  mode,
  recordKind = 'voice',
  onToggleRecordKind,
  holding,
  ariaLabel,
  disabled,
  className,
  buttonRef,
  onClick,
  onMenu,
  onRecordPointerDown,
}: {
  mode: MainButtonMode
  recordKind?: RecordKind
  /** Переключить голосовое ↔ кружок с клавиатуры или правым кликом. Нет — кружка нет. */
  onToggleRecordKind?: () => void
  /** Палец держит запись голосового: кнопка крупнее — как в Telegram. Цвет задаёт `className`. */
  holding: boolean
  ariaLabel: string
  disabled: boolean
  className: string
  buttonRef: RefObject<HTMLButtonElement | null>
  onClick: () => void
  /** Меню способа отправки у точки; `undefined` — меню нет (правка, запись). */
  onMenu?: (x: number, y: number) => void
  onRecordPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Долгое нажатие уже открыло меню — следующий за ним click не должен отправить сообщение.
  const swallowClick = useRef(false)

  const clearPress = (): void => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  const icon = (active: boolean): string =>
    cn(
      'absolute size-6 transition-[scale,opacity] duration-(--motion-large) lg:size-5 motion-reduce:scale-100',
      active ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
    )

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (swallowClick.current) {
          swallowClick.current = false
          return
        }
        onClick()
      }}
      onContextMenu={(e) => {
        // Меню браузера на кнопке отправки бесполезно; на записи — мешает удержанию.
        e.preventDefault()
        // На записи правый клик (и клавиша меню) — переключение голосового и кружка: мышью
        // короткое нажатие тоже переключает, а с клавиатуры другого пути нет.
        if (mode === 'record' && !holding) {
          onToggleRecordKind?.()
          return
        }
        if (!onMenu || mode !== 'send') return
        const box = e.currentTarget.getBoundingClientRect()
        const keyboard = e.clientX === 0 && e.clientY === 0
        onMenu(keyboard ? box.left : e.clientX, keyboard ? box.top : e.clientY)
      }}
      onKeyDown={() => {
        swallowClick.current = false
      }}
      onPointerDown={(e) => {
        swallowClick.current = false
        if (mode === 'record') {
          // Удержание пишет, короткое нажатие переключает (useComposerVoiceHold) — и палец, и
          // мышь. Click после отпускания запустил бы ещё и запись: click — для клавиатуры.
          swallowClick.current = true
          onRecordPointerDown(e)
          return
        }
        if (mode !== 'send' || !onMenu || e.pointerType === 'mouse') return
        clearPress()
        const box = e.currentTarget.getBoundingClientRect()
        pressTimer.current = setTimeout(() => {
          pressTimer.current = null
          swallowClick.current = true
          onMenu(box.left, box.top)
        }, LONG_PRESS_MS)
      }}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      className={cn(
        className,
        // Палец держит кнопку: браузер не должен ни прокручивать, ни выделять, ни звать меню.
        // transform в переходе не участвует: его пишет жест каждый кадр, и переход тянул бы
        // кнопку позади пальца. Рост при удержании — свойством scale, оно и анимируется.
        'relative touch-none select-none transition-[color,background-color,scale] [-webkit-touch-callout:none]',
        holding && 'z-10 scale-150 active:scale-150',
      )}
    >
      <Send className={icon(mode === 'send')} aria-hidden />
      <Check className={icon(mode === 'edit')} aria-hidden />
      <Mic className={icon(mode === 'record' && recordKind === 'voice')} aria-hidden />
      <Video className={icon(mode === 'record' && recordKind === 'video')} aria-hidden />
    </button>
  )
}
