'use client'

import { cn } from '../../lib/utils'

/**
 * Легенда: цветной ключ + подпись + значение. Если передан onToggle — элементы
 * становятся кнопками и скрывают/показывают серию на графике (обычный способ
 * разглядеть одну линию, когда остальные её перекрывают).
 *
 * `onFocusChange` — наведение (и фокус с клавиатуры) на элемент легенды: график
 * гасит остальные серии, пока курсор здесь. Это разглядывание без выключения, то
 * есть без потери контекста: линия остаётся на своём месте среди остальных.
 */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  onFocusChange,
  className,
}: {
  items: { key: string; label: string; color: string; value?: string; line?: boolean }[]
  hidden?: ReadonlySet<string>
  onToggle?: (key: string) => void
  onFocusChange?: (key: string | null) => void
  className?: string
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => {
        const off = hidden?.has(item.key) ?? false
        const body = (
          <>
            {/* Ключ повторяет метку: линия для линейных графиков, прямоугольник для заливок. */}
            <span
              aria-hidden
              className={cn('shrink-0 rounded-full', item.line ? 'h-0.5 w-4' : 'size-2.5')}
              style={{ backgroundColor: off ? 'currentColor' : item.color }}
            />
            {/* Текст — текстовыми токенами, а не цветом данных. */}
            <span className="text-muted-foreground">{item.label}</span>
            {item.value !== undefined && (
              <span className="font-semibold text-foreground tabular-nums">{item.value}</span>
            )}
          </>
        )
        return (
          <li key={item.key} className="flex items-center">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(item.key)}
                onPointerEnter={() => onFocusChange?.(item.key)}
                onPointerLeave={() => onFocusChange?.(null)}
                onFocus={() => onFocusChange?.(item.key)}
                onBlur={() => onFocusChange?.(null)}
                aria-pressed={!off}
                className={cn(
                  // Строка легенды — 16px текста; с `py-0.5` цель нажатия выходила 20px,
                  // меньше минимума WCAG 2.5.8 (24×24). Отступы дают 28px, отрицательный
                  // внешний гасит половину прибавки, чтобы легенда не разъехалась.
                  '-my-1 flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs outline-none transition-opacity hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
                  off && 'text-muted-foreground/50 opacity-60',
                )}
              >
                {body}
              </button>
            ) : (
              <span className="flex items-center gap-2 text-xs">{body}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
