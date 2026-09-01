'use client'

import * as React from 'react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { Check } from 'lucide-react'

import { cn } from 'shared/lib/utils'

// Системный чекбокс (radix-ui): квадрат со скруглением, синяя заливка при отметке,
// мягкий фокус-ринг в стиле Input/Select. Управляется через checked/onCheckedChange.
//
// Корень и видимый квадрат — разные элементы. Квадрат остаётся 20×20, а нажимается корень
// 28×28: цель в 20px меньше минимума WCAG 2.5.8 (24×24), и на телефоне в неё не попасть.
// Прибавку гасит отрицательный внешний отступ, поэтому в потоке чекбокс занимает те же 20px
// и раскладка форм не меняется. Увеличивать сам квадрат нельзя — это другой визуальный вес
// контрола во всех формах сразу (DESIGN_SYSTEM §13: область нажатия растят отступами).
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'group peer -m-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center p-1 outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        data-slot="checkbox-box"
        className="flex size-5 items-center justify-center rounded-md border border-input bg-background text-primary-foreground transition-[color,box-shadow,border-color] group-hover:border-ring/50 group-focus-visible:border-ring group-focus-visible:ring-4 group-focus-visible:ring-ring/15 group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-aria-invalid:border-destructive group-aria-invalid:ring-4 group-aria-invalid:ring-destructive/15 dark:bg-input/30"
      >
        <CheckboxPrimitive.Indicator
          data-slot="checkbox-indicator"
          className="flex items-center justify-center text-current"
        >
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
