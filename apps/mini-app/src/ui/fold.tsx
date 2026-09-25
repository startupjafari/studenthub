import type { ReactNode } from 'react'

/**
 * Складной раздел.
 *
 * Рычагов восемь, и развёрнутые сразу все они давали ленту в три экрана: чтобы дойти до
 * «Релиза», приходилось пролистать техработы, баннер, уведомления и разделы. Свёрнутый
 * раздел показывает главное — своё состояние прямо в заголовке, — и раскрывается касанием.
 *
 * `state` не украшение: ради ответа «идут ли сейчас техработы» раздел и открывали чаще
 * всего, а теперь его видно, не открывая.
 */
export function Fold({
  title,
  state,
  icon,
  children,
}: {
  title: string
  state?: string
  /** Цветная плитка слева: по ней раздел находят взглядом раньше, чем читают подпись. */
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <details className="card fold">
      <summary>
        {icon}
        <span className="fold-title">{title}</span>
        {state && <span className="fold-state">{state}</span>}
        <span className="fold-chevron" aria-hidden>
          ›
        </span>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  )
}
