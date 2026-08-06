'use client'

import { type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

const SIZE: Record<string, string> = {
  md: 'w-[calc(100%-2rem)] max-w-md max-h-[90vh]',
  lg: 'w-[calc(100%-2rem)] max-w-xl max-h-[90vh]',
  xl: 'w-[calc(100%-2rem)] max-w-2xl max-h-[90vh]',
  // upload — крупное окно загрузки: 60% ширины и 50% высоты экрана (с разумными минимумами).
  upload: 'h-[50vh] max-h-[92vh] min-h-[460px] w-[60vw] min-w-[min(92vw,560px)] max-w-none',
}

// Единая оболочка модального окна контента на Radix Dialog: правильная координация
// слоёв (Select/Popover внутри работают без блокировки pointer-events), фокус-трап,
// ESC/клик по фону, скролл длинного контента внутри окна.
export function ContentModal({
  title,
  onClose,
  size = 'md',
  children,
}: {
  title: string
  onClose: () => void
  size?: 'md' | 'lg' | 'xl' | 'upload'
  children: ReactNode
}) {
  const t = useTranslations('Profile')

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
            'fixed top-1/2 left-1/2 z-[100] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            SIZE[size],
          )}
        >
          <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={t('close')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
