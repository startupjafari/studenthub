'use client'

import * as React from 'react'
import { Select as SelectPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from 'shared/lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'

// Современный Select (radix-ui): триггер в стиле кастомного Input, мягкий фокус,
// скруглённый поповер с анимацией и синим индикатором выбора.
const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

function SelectTrigger({
  className,
  children,
  size = 'lg',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: ControlSize }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        // Высота — из общей шкалы контролов (control-size.ts): селект встаёт в одну
        // строку с кнопкой и полем того же размера.
        'flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-input bg-background py-2 transition-[color,box-shadow,border-color] outline-none hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 data-[placeholder]:text-muted-foreground/70 dark:bg-input/30 [&>span]:truncate',
        FIELD_SIZE[size],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/**
 * Поповер списка. Пустой список подписывается «Пусто» — раскрытая пустая рамка без
 * единой строки читается как поломка («не загрузилось?»), а не как «выбирать нечего».
 * Строка живёт здесь, а не на каждом экране: селект в системе один, и повторять проверку
 * в двух десятках вызовов означало бы, что где-то её забудут (DESIGN_SYSTEM §17).
 *
 * Пустота считается по отрисованным детям: `{items.map(...)}` с пустым массивом даёт
 * ноль элементов после `Children.toArray` (он разворачивает массивы и выбрасывает
 * `null`/`false`), поэтому условные `{cond && <SelectItem/>}` тоже учитываются верно.
 */
function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const t = useTranslations('Common')
  const isEmpty = React.Children.toArray(children).length === 0
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'relative z-[200] max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {isEmpty ? (
            // Не `SelectItem`: строка не выбирается и не должна попадать в навигацию
            // стрелками — это подпись состояния, а не вариант.
            <p className="px-2.5 py-2 text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            children
          )}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-sm outline-none select-none focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2.5 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-primary" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem }
