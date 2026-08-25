'use client'

import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { ArrowLeft, X } from 'lucide-react'
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
  /** Заголовок в шапке окна. Если не задан — sr-only (для a11y), в шапке только крестик. */
  title?: ReactNode
  /** Кнопка «назад» слева от заголовка (шаговые сценарии). Не показывать на первом шаге. */
  onBack?: () => void
  backLabel?: string
  size?: keyof typeof SIZE
  children: ReactNode
  className?: string
  /**
   * Классы тела окна. По умолчанию — прокручиваемая колонка с отступом `p-5`.
   * Нужен, когда содержимое рисует свои отступы и скролл само (панель, таблица во всю ширину):
   * `bodyClassName="overflow-hidden p-0"`.
   */
  bodyClassName?: string
}

// Единая оболочка модального окна на Radix Dialog: [← (опц.)] Заголовок … [крестик].
// Один выход из окна — крестик; стрелка «назад» только для навигации по шагам.
// Фокус-трап, ESC/клик по фону, скролл длинного контента внутри.
export function Modal({
  onClose,
  title,
  onBack,
  backLabel,
  size = 'xl',
  children,
  className,
  bodyClassName,
}: ModalProps) {
  const t = useTranslations('Common')

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-overlay/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-1/2 left-1/2 z-[100] flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            SIZE[size],
            className,
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  aria-label={backLabel ?? t('close')}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-5" aria-hidden />
                </button>
              )}
              <DialogPrimitive.Title
                className={cn('min-w-0 truncate text-base font-semibold', !title && 'sr-only')}
              >
                {title ?? t('close')}
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              aria-label={t('close')}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto p-5', bodyClassName)}>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
