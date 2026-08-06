'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, MoreHorizontal, Trash2 } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

// Меню действий над уведомлением («•••»): отметить прочитанным + удалить.
// Лёгкий поповер по паттерну post-tile-menu: закрывается по клику вне/Esc.
export function NotificationMenu({
  isRead,
  onMarkRead,
  onDelete,
}: {
  isRead: boolean
  onMarkRead: () => void
  onDelete: () => void
}) {
  const t = useTranslations('Notifications')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item =
    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={t('actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-20 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {!isRead && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                onMarkRead()
                setOpen(false)
              }}
            >
              <Check className="size-4 text-muted-foreground" aria-hidden />
              {t('markRead')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={cn(item, 'text-destructive hover:bg-destructive/10')}
            onClick={() => {
              onDelete()
              setOpen(false)
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('delete')}
          </button>
        </div>
      )}
    </div>
  )
}
