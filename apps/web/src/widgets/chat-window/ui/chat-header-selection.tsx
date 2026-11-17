'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Copy, Forward, Trash2, X } from 'lucide-react'
import { useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ChatHeaderIconButton } from './chat-header-button'

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
 * Панель выбора сообщений (Telegram: MessageSelectToolbar) — на месте шапки, пока идёт
 * выбор: «N сообщений», копировать, переслать, удалить.
 *
 * Клавиатура как в Telegram: Escape — выйти из выбора, Delete/Backspace — удалить
 * выбранное, Ctrl/⌘+C — скопировать текст выбранного. Пока открыт диалог или меню,
 * клавиши принадлежат им; в поле ввода Backspace и Ctrl+C остаются полю.
 *
 * Удалять можно только свои сообщения: кнопка учитывает именно их, а чужие из выбора
 * остаются в чате (сервер их не удалит), о чём окно предупредит отдельно.
 */
export function ChatHeaderSelection({
  count,
  ownCount,
  onCancel,
  onCopy,
  onForward,
  onDelete,
}: {
  count: number
  /** Сколько из выбранных — мои: удалить можно только их. */
  ownCount: number
  onCancel: () => void
  onCopy: () => void
  onForward: () => void
  /** Удалить (подтверждение уже получено). */
  onDelete: () => void
}) {
  const t = useTranslations('Chats')
  const confirm = useConfirm()

  const askDelete = (): void => {
    if (ownCount === 0) return
    void confirm({
      title: t('deleteSelectedConfirm', { count: ownCount }),
      confirmLabel: t('delete'),
      destructive: true,
    }).then((ok) => {
      if (ok) onDelete()
    })
  }

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

  return (
    <header className="flex items-center gap-1 border-b border-border px-2 py-3 duration-(--motion-page) animate-in fade-in-0 slide-in-from-top-2">
      <ChatHeaderIconButton aria-label={t('tgHeader.selectCancel')} onClick={onCancel}>
        <X aria-hidden />
      </ChatHeaderIconButton>
      <span
        className="min-w-0 flex-1 truncate px-1 text-base font-semibold tabular-nums"
        aria-live="polite"
      >
        {t('tgHeader.selectedMessages', { count })}
      </span>
      {count > 0 && (
        <>
          <ChatHeaderIconButton aria-label={t('copyText')} title={t('copyText')} onClick={onCopy}>
            <Copy aria-hidden />
          </ChatHeaderIconButton>
          <ChatHeaderIconButton aria-label={t('forward')} title={t('forward')} onClick={onForward}>
            <Forward aria-hidden />
          </ChatHeaderIconButton>
          {ownCount > 0 && (
            <ChatHeaderIconButton
              aria-label={t('delete')}
              title={t('delete')}
              onClick={askDelete}
              className={cn('text-destructive hover:bg-destructive/10 hover:text-destructive')}
            >
              <Trash2 aria-hidden />
            </ChatHeaderIconButton>
          )}
        </>
      )}
    </header>
  )
}
