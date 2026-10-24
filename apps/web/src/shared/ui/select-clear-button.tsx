'use client'

import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ControlSize } from './control-size'

// Крестик стоит поверх места, которое триггер оставляет пустым перед шевроном
// (`SelectClearSlot`): отступ справа = горизонтальный отступ поля + шеврон + зазор −
// половина разницы размеров крестика и слота.
const RIGHT: Record<ControlSize, string> = {
  sm: 'right-7',
  md: 'right-7',
  lg: 'right-[1.875rem]',
  xl: 'right-[1.875rem]',
}

/**
 * Кнопка «Очистить» у селекта — отдельная кнопка рядом с триггером, а не элемент внутри него.
 *
 * Раньше это был `<span role="button" tabIndex={-1}>` внутри `<button>`: с клавиатуры до него
 * не добраться, а вложенная интерактивная роль в кнопке — невалидная разметка, которую
 * скринридеры читают как одну кнопку. Родитель обязан быть `relative`.
 */
export function SelectClearButton({
  size,
  label,
  onClear,
}: {
  size: ControlSize
  label: string
  onClear: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClear}
      className={cn(
        'absolute top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
        RIGHT[size],
      )}
    >
      <X className="size-4" aria-hidden />
    </button>
  )
}

/** Пустое место под крестик внутри триггера: подпись не заезжает под него. */
export function SelectClearSlot() {
  return <span className="size-4 shrink-0" aria-hidden />
}
