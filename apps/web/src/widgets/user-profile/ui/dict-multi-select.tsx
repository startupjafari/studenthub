'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'

interface DictMultiSelectProps {
  value: string[]
  onChange: (next: string[]) => void
  options: readonly string[]
  // Иконка/оформление значения (например, флаг языка) для чипа и пункта списка.
  renderItem?: (v: string) => ReactNode
  max?: number
}

interface MenuPos {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

// Раскрытие вниз/вверх в зависимости от свободного места; высота ограничена вьюпортом.
function computeMenuPos(r: DOMRect): MenuPos {
  const margin = 8
  const below = window.innerHeight - r.bottom - margin
  const above = r.top - margin
  const down = below >= 200 || below >= above
  return {
    left: r.left,
    width: r.width,
    maxHeight: Math.max(140, Math.floor(down ? below : above)),
    ...(down ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
  }
}

// Мультивыбор из справочника + свободный ввод («другой»): чипы выбранного, поиск по списку,
// добавление своего значения, если его нет в справочнике.
export function DictMultiSelect({
  value,
  onChange,
  options,
  renderItem,
  max = 30,
}: DictMultiSelectProps) {
  const t = useTranslations('Profile')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (r) setPos(computeMenuPos(r))
    }
    place()
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (boxRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const has = (v: string) => value.some((x) => x.toLowerCase() === v.trim().toLowerCase())

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => !has(o) && (q === '' || o.toLowerCase().includes(q))).slice(0, 8)
  }, [query, options, value])

  const q = query.trim()
  const exact = options.some((o) => o.toLowerCase() === q.toLowerCase())
  const canAddCustom = q.length > 0 && !exact && !has(q)

  function add(v: string): void {
    const val = v.trim()
    if (!val || has(val) || value.length >= max) return
    onChange([...value, val])
    setQuery('')
  }
  function remove(v: string): void {
    onChange(value.filter((x) => x !== v))
  }

  return (
    <div ref={boxRef} className="relative flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary"
            >
              {renderItem ? renderItem(v) : v}
              <button
                type="button"
                aria-label={t('delete')}
                onClick={() => remove(v)}
                className="cursor-pointer text-primary/70 hover:text-primary"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (suggestions[0]) add(suggestions[0])
            else if (canAddCustom) add(q)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder={t('dictPlaceholder')}
        className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-[color,box-shadow,border-color] placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm dark:bg-input/30"
      />

      {open &&
        pos &&
        (suggestions.length > 0 || canAddCustom) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            // Не даём Radix Dialog воспринять клик по меню как «снаружи» и закрыть окно.
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              // Внутри Radix Dialog (modal) body получает pointer-events:none — возвращаем клики меню.
              pointerEvents: 'auto',
            }}
            className="z-[200] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {suggestions.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => add(o)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                {renderItem ? renderItem(o) : o}
              </button>
            ))}
            {canAddCustom && (
              <button
                type="button"
                onClick={() => add(q)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-muted"
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                {t('dictAddCustom', { value: q })}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
