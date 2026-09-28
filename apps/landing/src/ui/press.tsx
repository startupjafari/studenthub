import type { CSSProperties, ReactNode } from 'react'

/**
 * Отклик на курсор и на палец — чистым CSS (.sh-lift и .sh-tap в globals.css).
 *
 * Раньше это были `whileHover`/`whileTap` Framer Motion с пружиной: каждое наведение
 * запускало расчёт пружины в основном потоке, а сами компоненты были клиентскими и
 * гидрировались ради одного подъёма на три пикселя. CSS-переход по transform браузер
 * ведёт в потоке композитора, и компоненты снова серверные.
 *
 * Подъём — только там, где курсор есть: на тач-экране `:hover` залипает после тапа, и
 * карточка оставалась бы приподнятой до следующего касания в другом месте.
 */
export function Lift({
  children,
  className = '',
  lift = -4,
}: {
  children: ReactNode
  className?: string
  lift?: number
}) {
  return (
    <div className={`sh-lift ${className}`} style={{ '--lift': `${lift}px` } as CSSProperties}>
      {children}
    </div>
  )
}

/** Ссылка-кнопка с откликом на нажатие. Разметка та же, что у обычной `<a>`. */
export function TapLink({
  href,
  children,
  className = '',
  external = false,
  ariaLabel,
}: {
  href: string
  children: ReactNode
  className?: string
  external?: boolean
  ariaLabel?: string
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      // rel без noopener был бы дырой: страница-получатель получает window.opener.
      {...(external ? { rel: 'noopener' } : {})}
      className={`sh-tap ${className}`}
    >
      {children}
    </a>
  )
}
