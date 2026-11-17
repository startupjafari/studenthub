'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useConfirm } from '../../../shared/ui'

/** Открытый слой поверх чата: клавиши выбора тогда принадлежат ему. */
const OVERLAY_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[data-radix-popper-content-wrapper],[data-overlay]'

function isEditable(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

/**
 * «Удалить выбранное» с подтверждением — одно на шапку выбора (клавиша Delete) и на нижнюю
 * панель (кнопка). Удалять можно только свои сообщения: подтверждение называет именно их
 * число, а чужие из выбора остаются в чате (сервер их не удалит).
 */
export function useSelectionDelete(ownCount: number, onDelete: () => void): () => void {
  const t = useTranslations('Chats')
  const confirm = useConfirm()
  return () => {
    if (ownCount === 0) return
    void confirm({
      title: t('deleteSelectedConfirm', { count: ownCount }),
      confirmLabel: t('delete'),
      destructive: true,
    }).then((ok) => {
      if (ok) onDelete()
    })
  }
}

/**
 * Шапка режима выбора сообщений, как в Telegram на телефоне: сверху — «N сообщений» и
 * «Отмена», а сами действия (переслать, удалить, копировать, скачать, пожаловаться) — внизу,
 * на месте поля ввода (ui/chat-selection-bar).
 *
 * Клавиатура как в Telegram и живёт здесь, пока шапка на экране: Escape — выйти из выбора,
 * Delete/Backspace — удалить выбранное, Ctrl/⌘+C — скопировать текст выбранного. Пока открыт
 * диалог или меню, клавиши принадлежат им; в поле ввода Backspace и Ctrl+C остаются полю.
 */
export function ChatHeaderSelection({
  count,
  ownCount,
  onCancel,
  onCopy,
  onDelete,
}: {
  count: number
  /** Сколько из выбранных — мои: удалить можно только их. */
  ownCount: number
  onCancel: () => void
  onCopy: () => void
  /** Удалить (подтверждение уже получено). */
  onDelete: () => void
}) {
  const t = useTranslations('Chats')
  const tCommon = useTranslations('Common')
  const askDelete = useSelectionDelete(ownCount, onDelete)

  // Обработчики меняются каждый рендер — слушатель один, читает свежие через ref.
  const handlers = useRef({ count, onCancel, onCopy, askDelete })
  handlers.current = { count, onCancel, onCopy, askDelete }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || document.querySelector(OVERLAY_SELECTOR)) return
      const h = handlers.current
      if (e.key === 'Escape') {
        // preventDefault — чтобы глобальный «Esc = назад» не увёл со страницы тем же нажатием.
        e.preventDefault()
        h.onCancel()
        return
      }
      if (isEditable(document.activeElement)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && h.count > 0) {
        e.preventDefault()
        h.askDelete()
        return
      }
      if (
        e.key.toLowerCase() === 'c' &&
        (e.ctrlKey || e.metaKey) &&
        h.count > 0 &&
        // Выделенный мышью текст копируется как обычно.
        !window.getSelection()?.toString()
      ) {
        e.preventDefault()
        h.onCopy()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Высота — как у обычной шапки (py-3 вокруг 44/40-px ряда): линия под шапкой не прыгает.
  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-3 duration-(--motion-page) animate-in fade-in-0 slide-in-from-top-2">
      <span
        className="min-w-0 flex-1 truncate text-base font-semibold tabular-nums"
        aria-live="polite"
      >
        {t('tgHeader.selectedMessages', { count })}
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="-mr-2 h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95 lg:h-10"
      >
        {tCommon('cancel')}
      </button>
    </header>
  )
}
