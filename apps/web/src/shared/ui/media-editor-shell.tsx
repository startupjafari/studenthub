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
 * Это не окно поверх страницы, а панель на весь экран: сцена забирает всё место, какое
 * есть, — у модального окна снимок ужимался до трети экрана. Инструменты и кнопки внизу
 * держатся колонкой умеренной ширины: на широком мониторе линейка угла во весь экран
 * была бы неудобна. Отступы шапки и подвала учитывают вырез и «полоску» телефона.
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
      className="dark fixed inset-0 z-[100] flex flex-col overflow-hidden bg-background text-foreground animate-in fade-in-0 duration-200"
    >
      <div className="flex items-start gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
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

      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {footer}
      </div>
    </div>,
    document.body,
  )
}
