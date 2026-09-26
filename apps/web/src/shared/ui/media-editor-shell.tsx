'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '../lib'

/**
 * Оболочка редактора медиа перед загрузкой — в духе редактора Telegram: окно всегда тёмное,
 * медиа на чёрной сцене во всю ширину, инструменты и кнопки снизу.
 *
 * Тёмное — классом `dark` на самом окне: токены темы переопределяются только внутри него,
 * поэтому кнопки, подписи и рамки внутри берут тёмные значения и в светлой теме. Снимок
 * оценивают на нейтральном фоне — светлая тема «съедала» бы светлые края кадра.
 *
 * На телефоне окно во весь экран, с sm — по центру с полями.
 */
export function MediaEditorShell({
  title,
  hint,
  onClose,
  footer,
  children,
}: {
  title: string
  hint?: string
  onClose: () => void
  /** Нижняя строка: «Отмена» и главное действие. */
  footer: ReactNode
  /** Сцена и панель инструментов. */
  children: ReactNode
}) {
  const t = useTranslations('Common')
  useBodyScrollLock()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in-0 duration-200 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dark flex h-full w-full flex-col overflow-hidden bg-background text-foreground animate-in zoom-in-95 duration-200 sm:h-[min(90vh,46rem)] sm:w-[min(92vw,56rem)] sm:rounded-2xl sm:border sm:border-border"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>

        <div className="flex items-center gap-2 px-4 pt-3 pb-4">{footer}</div>
      </div>
    </div>,
    document.body,
  )
}
