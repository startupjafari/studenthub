'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Play, Quote } from 'lucide-react'
import {
  fetchAttachmentLink,
  isViewable,
  mediaPreview,
  type MessageAttachment,
  type MessageReplyPreview,
  type ReplyMediaPreview,
} from '../../../entities/chat'
import { identityAccent, plainPreview } from '../../../shared/lib'
import { MediaImage } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { PREVIEW_KEY, singleMediaName } from './chat-list-preview'

export type MessageReplyQuoteProps = {
  replyTo: MessageReplyPreview
  /** Процитированный фрагмент: показывается вместо начала оригинала. */
  quote: string | null
  name: string | null
  mine: boolean
  onOpen: (id: string) => void
}

/**
 * Снимок или ролик, который годится в миниатюру цитаты: картинка или видео, не голосовое и не
 * отправленное «файлом» — у тех в Telegram в цитате только подпись.
 */
export function replyThumbOf(
  media: readonly ReplyMediaPreview[] | undefined,
): ReplyMediaPreview | null {
  const first = media?.[0]
  if (!first) return null
  // isViewable читает только вид вложения; размер ему не нужен.
  return isViewable({ ...first, size: 0 } as MessageAttachment) ? first : null
}

/**
 * Миниатюра медиа в цитате ответа и в плашке ответа над полем ввода (Telegram).
 *
 * Сначала — LQIP из самого сообщения, затем копия по ширине из медиа-системы (у ролика —
 * постер). Ключ кэша тот же, что у вложений переписки: ссылка, уже полученная пузырём
 * оригинала, переиспользуется. Спойлер остаётся размытым, кружок — кругом.
 */
export function ReplyThumb({ media, className }: { media: ReplyMediaPreview; className?: string }) {
  const link = useQuery({
    queryKey: ['chat-attachment', media.id],
    queryFn: () => fetchAttachmentLink(media.id),
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
  const isVideo = media.mime.startsWith('video/')
  const variants = (isVideo ? link.data?.poster : link.data?.sources) ?? []
  // У видео оригинал — ролик, картинкой он не станет: только постер.
  const src = isVideo ? variants[variants.length - 1]?.url : link.data?.url
  return (
    <span
      aria-hidden
      className={cn(
        'relative size-9 shrink-0 overflow-hidden bg-foreground/10',
        media.videoNote ? 'rounded-full' : 'rounded-[0.25rem]',
        className,
      )}
    >
      <MediaImage
        src={src}
        media={{ placeholder: media.placeholder, sources: variants, width: null }}
        alt=""
        sizes="36px"
        className={cn('size-full', media.spoiler && 'blur-[3px]')}
      />
      {isVideo && !media.videoNote && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
          <Play className="size-3 fill-current" />
        </span>
      )}
    </span>
  )
}

/**
 * Встроенная цитата ответа (Telegram): плашка цветом автора оригинала — полоса слева, имя
 * тем же цветом, одна строка текста (у цитаты фрагмента — до трёх, со значком цитаты).
 * У оригинала со снимком или роликом — миниатюра слева от текста, как в Telegram.
 * На своём (синем) пузыре цвет человека нечитаем, там плашка светлая, как в Telegram.
 */
export function MessageReplyQuote({ replyTo, quote, name, mine, onOpen }: MessageReplyQuoteProps) {
  const t = useTranslations('Chats')
  const accent = identityAccent(replyTo.senderId)
  const thumb = replyTo.deletedAt ? null : replyThumbOf(replyTo.media)
  // Без текста — вид вложения, как в Telegram: «Голосовое сообщение», «Фото», «Видео»,
  // а не безликое «Вложение». mediaPreview читает только вид файла — размер ему не нужен.
  const media = (replyTo.media ?? []).map((m) => ({ ...m, size: 0 }) as MessageAttachment)
  const kind = mediaPreview(media)
  const text = replyTo.deletedAt
    ? t('replyDeleted')
    : plainPreview(quote || replyTo.content) ||
      (thumb?.videoNote
        ? t('tgMessage.replyRound')
        : kind
          ? (singleMediaName(media) ?? t(PREVIEW_KEY[kind.kind], { n: 1 }))
          : t('attachment'))
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
      {thumb && <ReplyThumb media={thumb} className="my-1 ml-1.5 self-center" />}
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
