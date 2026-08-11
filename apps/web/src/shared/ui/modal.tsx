'use client'

import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

const SIZE = {
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-2xl',
  '2xl': 'max-w-3xl',
  '3xl': 'max-w-4xl',
} as const

export interface ModalProps {
  onClose: () => void
  /** Заголовок в шапке окна. Если не задан — показывается только кнопка закрытия (sr-only заголовок для a11y). */
  title?: ReactNode
  size?: keyof typeof SIZE
  children: ReactNode
  className?: string
}

// Единая оболочка модального окна на Radix Dialog: фокус-трап, ESC/клик по фону,
// скролл длинного контента внутри, координация слоёв (Select/Popover внутри работают).
export function Modal({ onClose, title, size = 'xl', children, className }: ModalProps) {
  const t = useTranslations('Common')

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-foreground/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-1/2 left-1/2 z-[100] flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            SIZE[size],
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <DialogPrimitive.Title
              className={cn('truncate text-base font-semibold', !title && 'sr-only')}
            >
              {title ?? t('close')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('close')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
