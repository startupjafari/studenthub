'use client'

import * as React from 'react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import { X } from 'lucide-react'

import { cn } from 'shared/lib/utils'

// Выдвижная панель (radix Dialog) в языке StudentHub. `side`:
// - right/left — боковой Drawer (десктоп: детали, фильтры, workspace-панель);
// - bottom — BottomSheet (мобильные действия/детали).
// Модальное окно по центру — отдельный компонент `Modal`. Оба на Radix Dialog.
const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

const SIDE = {
  right:
    'inset-y-0 right-0 h-full w-full max-w-md border-l data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
  left: 'inset-y-0 left-0 h-full w-full max-w-md border-r data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
  bottom:
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
} as const

interface SheetContentProps extends React.ComponentProps<typeof SheetPrimitive.Content> {
  side?: keyof typeof SIDE
  /** Убрать встроенную кнопку-крестик (когда шапка своя). */
  hideClose?: boolean
}

function SheetContent({
  className,
  children,
  side = 'right',
  hideClose,
  ...props
}: SheetContentProps) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-[190] bg-overlay/30 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-[200] flex flex-col gap-4 overflow-y-auto border-border bg-card p-5 text-card-foreground',
          side === 'bottom' && 'pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
          SIDE[side],
          className,
        )}
        {...props}
      >
        {side === 'bottom' && (
          <div
            className="mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            aria-hidden
          />
        )}
        {children}
        {!hideClose && (
          <SheetPrimitive.Close
            className="absolute top-4 right-4 rounded-lg p-1 text-muted-foreground opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-4 focus-visible:ring-ring/20"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-header" className={cn('flex flex-col gap-1', className)} {...props} />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-heading text-lg font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription }
