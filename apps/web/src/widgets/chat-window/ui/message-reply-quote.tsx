'use client'

import { useTranslations } from 'next-intl'
import { Quote } from 'lucide-react'
import type { MessageReplyPreview } from '../../../entities/chat'
import { identityAccent, plainPreview } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'

export type MessageReplyQuoteProps = {
  replyTo: MessageReplyPreview
  /** Процитированный фрагмент: показывается вместо начала оригинала. */
  quote: string | null
  name: string | null
  mine: boolean
  onOpen: (id: string) => void
}

/**
 * Встроенная цитата ответа (Telegram): плашка цветом автора оригинала — полоса слева, имя
 * тем же цветом, одна строка текста (у цитаты фрагмента — до трёх, со значком цитаты).
 * На своём (синем) пузыре цвет человека нечитаем, там плашка светлая, как в Telegram.
 */
export function MessageReplyQuote({ replyTo, quote, name, mine, onOpen }: MessageReplyQuoteProps) {
  const t = useTranslations('Chats')
  const accent = identityAccent(replyTo.senderId)
  const text = replyTo.deletedAt
    ? t('replyDeleted')
    : plainPreview(quote || replyTo.content) || t('attachment')
  return (
    <button
      type="button"
      onClick={() => onOpen(replyTo.id)}
      aria-label={t('tgBubbles.replyTo', { name: name ?? '' })}
      className={cn(
        'relative mb-1 flex w-full min-w-0 overflow-hidden rounded-sm text-left text-[0.8125rem] leading-snug',
        mine
          ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25'
          : cn(accent.tint, 'hover:brightness-95 dark:hover:brightness-110'),
      )}
    >
      <span
        aria-hidden
        className={cn('w-[3px] shrink-0', mine ? 'bg-primary-foreground' : accent.bar)}
      />
      <span className={cn('min-w-0 flex-1 py-1 pl-1.5', quote ? 'pr-5' : 'pr-2')}>
        <span
          className={cn(
            'block truncate font-medium',
            mine ? 'text-primary-foreground' : accent.text,
          )}
        >
          {name}
        </span>
        <span
          className={cn(
            'block',
            quote ? 'line-clamp-3' : 'truncate',
            replyTo.deletedAt && 'italic',
            mine ? 'text-primary-foreground/90' : 'text-foreground/80',
          )}
        >
          {text}
        </span>
      </span>
      {quote && (
        <Quote
          aria-hidden
          className={cn(
            'absolute top-1 right-1 size-3',
            mine ? 'text-primary-foreground/80' : accent.text,
          )}
        />
      )}
    </button>
  )
}
