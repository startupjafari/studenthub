'use client'

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { cn } from 'shared/lib/utils'

// Ошибка поля (DESIGN_SYSTEM §10.3). Стоит в строке подписи справа: поле, у которого первой
// идёт подпись, раскладывается сеткой «подпись | ошибка» правилом `[data-field-error]` в
// globals.css. Поэтому ошибка не добавляет строку под полем, и форма не прыгает по высоте,
// когда она появляется. Порядок в разметке прежний — после контрола: скринридер читает
// поле, потом что с ним не так. Поле без подписи первой строкой (чекбокс с текстом справа,
// подпись со ссылкой «Забыли пароль?») оставляет ошибку под собой.
//
// Не влезший текст — бегущая строка: компонент сам меряет ширину и, если текст длиннее
// места, плавно прокручивает его к концу и обратно. При «уменьшении движения» прокрутки
// нет — текст обрезается многоточием, полный — во всплывающей подсказке.
//
// `role="alert"` обязателен, иначе скринридер не объявит появившийся текст. Пустое
// значение ничего не рисует, поэтому вызов можно ставить безусловно:
// <FieldError>{errors.title?.message}</FieldError>.

/** Скорость прокрутки — px в секунду; плюс паузы в начале и в конце (keyframes). */
const MARQUEE_SPEED = 40
const MARQUEE_MIN_SECONDS = 4

export function FieldError({ children, className }: { children?: ReactNode; className?: string }) {
  const box = useRef<HTMLParagraphElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  const visible = Boolean(children)

  useLayoutEffect(() => {
    const boxEl = box.current
    const textEl = text.current
    if (!visible || !boxEl || !textEl) return
    const measure = (): void => {
      const extra = textEl.scrollWidth - boxEl.clientWidth
      setOverflow(extra > 1 ? Math.ceil(extra) : 0)
    }
    measure()
    // Без ResizeObserver (старый браузер, jsdom в тестах) меряем один раз при показе.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(boxEl)
    observer.observe(textEl)
    return () => observer.disconnect()
  }, [visible, children])

  if (!visible) return null
  const style =
    overflow > 0
      ? ({
          '--sh-marquee-shift': `-${overflow}px`,
          '--sh-marquee-duration': `${Math.max(MARQUEE_MIN_SECONDS, overflow / MARQUEE_SPEED + 3)}s`,
        } as CSSProperties)
      : undefined
  return (
    <p
      ref={box}
      role="alert"
      data-field-error=""
      title={overflow > 0 && typeof children === 'string' ? children : undefined}
      className={cn('min-w-0 overflow-hidden text-xs leading-tight text-destructive', className)}
    >
      <span
        ref={text}
        data-marquee={overflow > 0 ? '' : undefined}
        className="inline-block max-w-none whitespace-nowrap"
        style={style}
      >
        {children}
      </span>
    </p>
  )
}
