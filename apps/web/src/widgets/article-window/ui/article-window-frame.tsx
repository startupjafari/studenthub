'use client'

import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

/** Открыт ли поверх окна оверлей приложения вне диалогов (меню сообщения и т. п.). */
function overlayAbove(): boolean {
  return Array.from(document.querySelectorAll('[data-overlay]')).some(
    (el) => !el.closest('[role="dialog"]'),
  )
}

/**
 * Рамка окна статьи: на телефоне — во весь экран, с `sm` — большое окно по центру.
 *
 * Не общий `Modal`: тот кладёт в историю запись-пустышку (`useBackClose`), а у окна статьи
 * запись своя — его адрес (`?article=`). Две записи на одно окно давали бы «назад», которое
 * сначала ничего не закрывает.
 *
 * `guarded` — окно редактора: клик мимо и Esc его не закрывают, длинный текст пишут долго,
 * и случайное закрытие посреди абзаца раздражало бы, даже если черновик сохранён.
 */
export function ArticleWindowFrame({
  title,
  onClose,
  guarded = false,
  children,
}: {
  title: string
  onClose: () => void
  guarded?: boolean
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-overlay/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:duration-(--motion-modal) data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Меню и окна приложения поверх (`data-overlay`) — для Radix «снаружи»; нажатие в
          // них и Escape, который они гасят сами, окно статьи закрывать не должны.
          onInteractOutside={(e) => {
            if (guarded || (e.target as Element | null)?.closest?.('[data-overlay]')) {
              e.preventDefault()
            }
          }}
          onEscapeKeyDown={(e) => {
            if (guarded || overlayAbove()) e.preventDefault()
          }}
          className={cn(
            // Низ — над экранной клавиатурой (`--kb-inset`): на iOS она накрывала бы текст.
            'fixed inset-x-0 top-0 bottom-[var(--kb-inset,0px)] z-[100] flex flex-col overflow-hidden bg-background outline-none',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:max-w-[76rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:border-border',
            'data-[state=open]:animate-in data-[state=open]:duration-(--motion-modal) data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Крестик окна статьи — в его верхней панели. */
export function ArticleWindowClose({ onClick }: { onClick: () => void }) {
  const t = useTranslations('Common')
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('close')}
      title={t('close')}
      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <X className="size-5" aria-hidden />
    </button>
  )
}
