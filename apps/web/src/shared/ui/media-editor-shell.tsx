'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '../lib'
import { cn } from '../lib/utils'

/**
 * Оболочка редактора медиа перед загрузкой — в духе редактора Telegram: окно всегда тёмное,
 * медиа на чёрной сцене во всю ширину, инструменты и кнопки снизу.
 *
 * Тёмное — классом `dark` на самом окне: токены темы переопределяются только внутри него,
 * поэтому кнопки, подписи и рамки внутри берут тёмные значения и в светлой теме. Снимок
 * оценивают на нейтральном фоне — светлая тема «съедала» бы светлые края кадра.
 *
 * Это не окно поверх страницы, а панель на весь экран в оформлении просмотрщика фото
 * (MediaViewer): полупрозрачный чёрный фон, без плашки под шапку, белые круглые кнопки.
 * Сцена забирает всё место, какое есть, — у модального окна снимок ужимался до трети экрана. Инструменты и кнопки внизу
 * держатся колонкой умеренной ширины: на широком мониторе линейка угла во весь экран
 * была бы неудобна. Отступы шапки и подвала учитывают вырез и «полоску» телефона.
 */
export function MediaEditorShell({
  title,
  hint,
  onClose,
  footer,
  actions,
  solid = false,
  children,
}: {
  title: string
  hint?: string
  onClose: () => void
  /** Нижняя строка: «Отмена» и главное действие. Без неё строку рисует сам редактор. */
  footer?: ReactNode
  /** Кнопки в шапке перед «закрыть» (отмена и повтор правки). */
  actions?: ReactNode
  /**
   * Непрозрачный фон вместо притемнения. Редактору с панелями (сторис) страница под ним
   * только мешает: сквозь панели просвечивали бы лента и меню.
   */
  solid?: boolean
  /** Сцена и панель инструментов. */
  children: ReactNode
}) {
  const t = useTranslations('Common')
  // Второй аргумент — запрет выделения на всей странице: оверлей перетаскивают,
  // и без него браузер выделяет текст, лежащий ПОД ним (см. хук).
  useBodyScrollLock(true, true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc уже забрало вложенное окно Radix (выпадающий список, диалог поверх редактора):
      // оно закрывается само и помечает событие — редактор при этом остаётся открытым.
      if (e.key === 'Escape' && !e.defaultPrevented) {
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
      // Как у MediaViewer: `pointer-events-auto` — поверх Radix Dialog (аватар группы) body
      // получает `pointer-events: none`, и без этого кнопки редактора не нажимались бы;
      // `data-overlay` — глобальный Esc закрывает слой, а не уводит на прошлую страницу.
      data-overlay
      className={cn(
        'dark pointer-events-auto fixed inset-0 z-[100] flex flex-col overflow-hidden text-white select-none animate-in fade-in-0 duration-200',
        solid ? 'bg-background' : 'bg-black/80',
      )}
    >
      <div className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {hint && <p className="truncate text-xs text-white/60">{hint}</p>}
        </div>
        {actions}
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      {footer && (
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </div>,
    document.body,
  )
}
