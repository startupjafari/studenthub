import type { ReactNode } from 'react'

import { cn } from '../../../shared/lib/utils'

// Строительные блоки самой витрины (не продуктовые компоненты). Собраны в языке
// системы: заголовки, карточки-поверхности, подписи `text-xs text-muted-foreground`.

/** Раздел витрины. `id` — якорь для боковой навигации. */
export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{title}</h2>
        {note && <p className="max-w-3xl text-sm text-muted-foreground">{note}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

/**
 * Одна демонстрация: подпись, необязательное правило применения и сам пример
 * на поверхности карточки.
 */
export function Demo({
  label,
  rule,
  className,
  children,
}: {
  label: string
  rule?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">{label}</h3>
        {rule && <p className="text-xs text-muted-foreground">{rule}</p>}
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Имя класса/токена моноширинным — чтобы отличалось от подписей. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  )
}

/** Подпись под примером. */
export function Caption({ children }: { children: ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>
}

/**
 * Образец цвета. Показывает и сам цвет, и имя токена: витрина существует, чтобы
 * из неё копировали имя, а не подбирали похожий оттенок на глаз.
 */
export function Swatch({
  token,
  className,
  note,
  wide,
}: {
  token: string
  className: string
  note?: string
  wide?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', wide ? 'w-full' : 'w-32')}>
      <div className={cn('h-12 rounded-lg ring-1 ring-foreground/10', className)} />
      <div className="flex flex-col">
        <Code>{token}</Code>
        {note && <span className="mt-0.5 text-[0.6875rem] text-muted-foreground">{note}</span>}
      </div>
    </div>
  )
}

/** Предупреждение о частой ошибке применения. */
export function Pitfall({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border-l-2 border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
      {children}
    </p>
  )
}
