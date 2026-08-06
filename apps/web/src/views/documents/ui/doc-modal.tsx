'use client'

import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

const SIZE: Record<string, string> = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }

// Оболочка модального окна раздела «Документы» на Radix Dialog (Select/Popover внутри работают).
export function DocModal({
  title,
  onClose,
  size = 'lg',
  children,
  footer,
}: {
  title: string
  onClose: () => void
  size?: 'md' | 'lg' | 'xl'
  children: ReactNode
  footer?: ReactNode
}) {
  const t = useTranslations('Common')
  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-foreground/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-1/2 left-1/2 z-[100] flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            SIZE[size],
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('close')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
