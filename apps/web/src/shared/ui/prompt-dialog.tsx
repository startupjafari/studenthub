'use client'

import { useEffect, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'
import { Textarea } from './textarea'

// Системный prompt с текстовым вводом (замена window.prompt) — единый стиль, доступность.
export function PromptDialog({
  open,
  title,
  placeholder,
  multiline,
  required,
  submitLabel,
  cancelLabel,
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
  submitLabel: string
  cancelLabel: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  useEffect(() => {
    if (open) setValue('')
  }, [open])

  const disabled = required && value.trim().length === 0

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-overlay/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border border-border bg-card p-6 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between gap-3">
            <DialogPrimitive.Title className="text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={cancelLabel}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!disabled) onSubmit(value.trim())
            }}
          >
            {multiline ? (
              <Textarea
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
                rows={3}
              />
            ) : (
              <Input
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {cancelLabel}
              </Button>
              <Button type="submit" disabled={disabled}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
