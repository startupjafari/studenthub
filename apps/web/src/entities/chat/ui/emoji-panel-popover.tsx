'use client'

import { lazy, Suspense } from 'react'
import { cn } from '../../../shared/lib/utils'
import type { EmojiPanelProps } from './emoji-panel'

// Панель — отдельным чанком: она нужна только по нажатию на смайл или стрелку реакций, и в
// бандл страниц с перепиской (события, поддержка, окна вложений) не идёт.
const EmojiPanel = lazy(() => import('./emoji-panel').then((m) => ({ default: m.EmojiPanel })))

/**
 * Панель эмодзи Telegram-вида во всплывающей коробке — одна на всю переписку: поле ввода
 * обсуждения события и обращения в поддержку, подпись вложения и пересылки, полный набор
 * реакций в меню сообщения. Размер по умолчанию — как у панели в поле ввода чата.
 *
 * Пока чанк едет, стоит пустая коробка того же размера: всплывшее окно не прыгает.
 */
export function EmojiPanelPopover({
  className,
  ...props
}: Omit<EmojiPanelProps, 'variant'> & { className?: string }) {
  return (
    <div
      className={cn(
        'h-[22.375rem] w-[24rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-lg',
        className,
      )}
    >
      <Suspense fallback={null}>
        <EmojiPanel variant="popover" {...props} />
      </Suspense>
    </div>
  )
}
