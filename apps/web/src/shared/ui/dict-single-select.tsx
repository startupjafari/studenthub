'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '../lib/utils'

interface DictSingleSelectProps {
  value: string
  onChange: (next: string) => void
  options: string[]
  renderItem?: (v: string) => ReactNode
}

interface MenuPos {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

// Раскрытие вниз, если снизу хватает места (или его больше, чем сверху); иначе — вверх.
// Высота ограничивается доступным местом, чтобы список не вылезал за экран.
function computeMenuPos(r: DOMRect): MenuPos {
  const margin = 8
  const below = window.innerHeight - r.bottom - margin
  const above = r.top - margin
  const down = below >= 220 || below >= above
  return {
    left: r.left,
    width: r.width,
    maxHeight: Math.max(140, Math.floor(down ? below : above)),
    ...(down ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
  }
}

// Одиночный выбор из справочника + свободный ввод («другой»): для полей вроде «Страна»/«Статус».
// Меню рендерим в портал (карточки имеют overflow-hidden — иначе список обрезается).
export function DictSingleSelect({ value, onChange, options, renderItem }: DictSingleSelectProps) {
  const t = useTranslations('Profile')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<MenuPos | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect()
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

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => q === '' || o.toLowerCase().includes(q)).slice(0, 10)
  }, [query, options])

  const q = query.trim()
  const exact = options.some((o) => o.toLowerCase() === q.toLowerCase())
  const canAddCustom = q.length > 0 && !exact

  function pick(v: string): void {
    onChange(v.trim())
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm dark:bg-input/30"
      >
        <span
          className={cn('flex items-center gap-1.5 truncate', !value && 'text-muted-foreground/70')}
        >
          {value ? (renderItem ? renderItem(value) : value) : t('dictPlaceholder')}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t('delete')}
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

      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
            className="z-[200] flex flex-col rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (suggestions[0]) pick(suggestions[0])
                  else if (canAddCustom) pick(q)
                } else if (e.key === 'Escape') {
                  setOpen(false)
                }
              }}
              placeholder={t('dictPlaceholder')}
              className="mb-1 h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {suggestions.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => pick(o)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  {renderItem ? renderItem(o) : o}
                </button>
              ))}
              {canAddCustom && (
                <button
                  type="button"
                  onClick={() => pick(q)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-muted"
                >
                  <Plus className="size-4 shrink-0" aria-hidden />
                  {t('dictAddCustom', { value: q })}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
