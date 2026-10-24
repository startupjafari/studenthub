'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '../lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'
import { SelectClearButton, SelectClearSlot } from './select-clear-button'
import { useListboxKeys } from './use-listbox-keys'

interface DictSingleSelectProps {
  value: string
  onChange: (next: string) => void
  options: string[]
  renderItem?: (v: string) => ReactNode
  /** id триггера — для `<Label htmlFor>`. */
  id?: string
}

/**
 * Одиночный выбор из справочника + свободный ввод («другой»): для полей вроде «Страна»/«Статус».
 *
 * Меню — Radix Popover, как у `AsyncSelect`, а не свой портал в `body`: контрол живёт и в
 * модалках («Учебные данные студента»). Внутри Radix Dialog `body` получает
 * `pointer-events: none`, и меню-портал наследовало его — нажатие по пункту уходило на
 * подложку и закрывало окно, а поле поиска не набиралось: фокус-трап диалога выдёргивал
 * фокус обратно. Popover регистрируется во вложенном слое Radix и от обеих проблем избавлен;
 * `modal` нужен ради прокрутки списка внутри диалога (подробно — в `AsyncSelect`).
 */
export function DictSingleSelect({
  value,
  onChange,
  options,
  renderItem,
  id,
  size = 'lg',
}: DictSingleSelectProps & { size?: ControlSize }) {
  const t = useTranslations('Profile')
  const tCommon = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => q === '' || o.toLowerCase().includes(q)).slice(0, 10)
  }, [query, options])

  const q = query.trim()
  const exact = options.some((o) => o.toLowerCase() === q.toLowerCase())
  const canAddCustom = q.length > 0 && !exact

  function changeOpen(next: boolean): void {
    setOpen(next)
    if (!next) setQuery('')
  }

  function pick(v: string): void {
    onChange(v.trim())
    changeOpen(false)
  }

  // Строка «добавить своё» идёт последней в том же списке: стрелки ведут и по ней,
  // иначе до неё с клавиатуры не добраться.
  const rows = canAddCustom ? [...suggestions, q] : suggestions
  const keys = useListboxKeys({
    count: rows.length,
    resetKey: query,
    onPick: (i) => {
      const v = rows[i]
      if (v !== undefined) pick(v)
    },
  })

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={changeOpen} modal>
      <div className="relative">
        <PopoverPrimitive.Trigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-input bg-background outline-none transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 dark:bg-input/30',
              FIELD_SIZE[size],
            )}
          >
            <span
              className={cn(
                'flex items-center gap-1.5 truncate',
                !value && 'text-muted-foreground/70',
              )}
            >
              {value ? (renderItem ? renderItem(value) : value) : t('dictPlaceholder')}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {value && <SelectClearSlot />}
              <ChevronDown className="size-4 opacity-60" aria-hidden />
            </span>
          </button>
        </PopoverPrimitive.Trigger>
        {value && (
          <SelectClearButton size={size} label={tCommon('clear')} onClear={() => onChange('')} />
        )}
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Фокус сразу в поле поиска: иначе первое нажатие клавиши уходит в кнопку.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="z-[200] flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] flex-col rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={keys.onKeyDown}
            role="combobox"
            aria-expanded
            aria-activedescendant={keys.activeId}
            placeholder={t('dictPlaceholder')}
            className="mb-1 h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm"
          />
          <div role="listbox" className="min-h-0 flex-1 overflow-y-auto">
            {suggestions.map((o, i) => (
              <button
                key={o}
                id={keys.optionId(i)}
                type="button"
                role="option"
                aria-selected={keys.active === i}
                // Фокус не уводим с поля поиска: иначе после клика курсор терялся бы.
                onMouseDown={(e) => e.preventDefault()}
                // Мышь двигает ту же подсветку, что и стрелки: иначе наведение и
                // клавиатура спорят, и строк под выбором оказывается две.
                onMouseMove={() => keys.setActive(i)}
                onClick={() => pick(o)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                  keys.active === i && 'bg-muted',
                )}
              >
                {renderItem ? renderItem(o) : o}
              </button>
            ))}
            {canAddCustom && (
              <button
                id={keys.optionId(suggestions.length)}
                type="button"
                role="option"
                aria-selected={keys.active === suggestions.length}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => keys.setActive(suggestions.length)}
                onClick={() => pick(q)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-primary transition-colors',
                  keys.active === suggestions.length && 'bg-muted',
                )}
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                {t('dictAddCustom', { value: q })}
              </button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
