'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { ChevronDown, Loader2, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'

export interface AsyncSelectItem {
  value: string
  label: string
  // Вторая строка пункта: уточнение, когда названия совпадают («Абай» — и город, и район).
  hint?: string | null
}

interface AsyncSelectProps {
  value: string
  onChange: (next: string) => void
  // Подпись выбранного значения. Приходит снаружи: выбранного пункта может не быть
  // в текущей выдаче поиска — он резолвится отдельным запросом по коду.
  selectedLabel?: string | null
  items: AsyncSelectItem[]
  query: string
  onQueryChange: (next: string) => void
  loading?: boolean
  // Разрешить сохранить произвольный текст (зарубежный город, которого нет в справочнике).
  allowCustom?: boolean
  size?: ControlSize
  id?: string
  renderItem?: (item: AsyncSelectItem) => ReactNode
}

/**
 * Одиночный выбор из справочника, который живёт на сервере: список приходит снаружи,
 * а компонент отвечает только за раскрытие, поиск и клавиатуру. Отличие от
 * `DictSingleSelect` — там весь справочник лежит в бандле, здесь он слишком велик
 * (десятки тысяч записей), и выдачу считает бэкенд.
 *
 * Построен на Radix Popover, а не на своём портале: контрол должен работать внутри
 * модалки. У `Modal` (Radix Dialog) фокус-трап и закрытие по клику снаружи — меню,
 * отрендеренное порталом в `body`, оказывается «снаружи»: ввод не набирается, потому
 * что фокус выдёргивается обратно в диалог, а клик по пункту закрывает всё окно.
 * Popover регистрируется во вложенном слое Radix и от обеих проблем избавлен.
 *
 * `modal` на Root обязателен по третьей причине: Dialog блокирует прокрутку через
 * `RemoveScroll` с `shards: [contentRef]` — в белом списке только узел самой модалки,
 * и колесо мыши над меню глушится. `modal` включает собственный `RemoveScroll`
 * поповера, вложенный экземпляр становится активным, и список снова прокручивается.
 */
export function AsyncSelect({
  value,
  onChange,
  selectedLabel,
  items,
  query,
  onQueryChange,
  loading = false,
  allowCustom = false,
  size = 'lg',
  id,
  renderItem,
}: AsyncSelectProps) {
  const t = useTranslations('Common')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim()
  const canAddCustom = allowCustom && q.length > 0 && !items.some((i) => i.label === q)

  function pick(next: string): void {
    onChange(next)
    onQueryChange('')
    setOpen(false)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal>
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
            {value ? (selectedLabel ?? value) : t('dictPlaceholder')}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {value && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={t('clear')}
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('')
                }}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
              </span>
            )}
            <ChevronDown className="size-4 opacity-60" aria-hidden />
          </span>
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Фокус уводим на поле поиска сразу: иначе первое нажатие клавиши уходит в кнопку.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="z-[200] flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] flex-col rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div className="relative mb-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (items[0]) pick(items[0].value)
                  else if (canAddCustom) pick(q)
                }
              }}
              placeholder={t('dictPlaceholder')}
              className="h-11 w-full rounded-lg border border-input bg-background px-3.5 pr-10 text-base outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm"
            />
            {loading && (
              <Loader2
                className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.map((item) => (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={item.value === value}
                // Фокус не уводим с поля поиска: иначе после каждого клика курсор терялся бы.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item.value)}
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                {renderItem ? (
                  renderItem(item)
                ) : (
                  <>
                    <span className="truncate">{item.label}</span>
                    {item.hint && (
                      <span className="truncate text-xs text-muted-foreground">{item.hint}</span>
                    )}
                  </>
                )}
              </button>
            ))}
            {canAddCustom && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(q)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-muted"
              >
                {t('dictAddCustom', { value: q })}
              </button>
            )}
            {!loading && items.length === 0 && !canAddCustom && (
              <p className="px-2.5 py-3 text-sm text-muted-foreground">{t('nothingFound')}</p>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
