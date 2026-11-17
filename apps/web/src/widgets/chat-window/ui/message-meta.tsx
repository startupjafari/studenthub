'use client'

import type { CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { AlertCircle, Check, CheckCheck, Eye, Loader2, Pin } from 'lucide-react'
import { formatViews } from '../../../entities/chat'
import { cn } from '../../../shared/lib/utils'
import type { MessageReadState } from './message-item'

/**
 * Где стоит мета (время, «изм.», галочки) — как в Telegram:
 * - `text`  — внутри пузыря, в правом нижнем углу; текст обтекает её, оставляя под неё место
 *   в последней строке (см. `metaSpacerStyle`);
 * - `flow`  — обычным элементом строки (рядом с реакциями, под карточкой);
 * - `media` — тёмной плашкой поверх снимка без подписи;
 * - `float` — капсулой под стикером или крупными эмодзи, у которых нет пузыря.
 */
export type MessageMetaVariant = 'text' | 'flow' | 'media' | 'float'

export type MessageMetaProps = {
  createdAt: string
  edited: boolean
  pinned: boolean
  mine: boolean
  readState: MessageReadState
  readCount: number
  locale: string
  variant: MessageMetaVariant
  onRetry: () => void
  /**
   * Просмотры (официальные чаты, как посты канала в Telegram): глаз и число перед временем.
   * undefined — счётчика у чата нет или он ещё не пришёл.
   */
  views?: number
}

export function messageTime(createdAt: string, locale: string): string {
  return new Date(createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Место под мету в последней строке текста. Вместо измерения ширины — невидимая копия её
 * текста псевдоэлементом в конце последнего абзаца (`--meta-text`) плюс ширина значков
 * (`--meta-pad`): строка с временем помещается — текст и время делят строку, нет — время
 * уходит на новую строку, ровно как в Telegram. Без JS и без перерисовки пузыря.
 */
export function metaSpacerStyle(o: {
  time: string
  editedLabel: string | null
  pinned: boolean
  mine: boolean
  readState: MessageReadState
  readCount: number
  /** Подпись просмотров, как её рисует мета («1,2 тыс.»); нет — счётчика нет. */
  viewsLabel?: string | null
}): CSSProperties {
  const timeText = o.editedLabel ? `${o.editedLabel} ${o.time}` : o.time
  // Число просмотров — текстом в ту же распорку, глаз — в отступ значков.
  const text = o.viewsLabel ? `${o.viewsLabel} ${timeText}` : timeText
  // Отступ от текста 0.75rem + значки: булавка закрепа, галочки или статус отправки, число
  // прочитавших в группе.
  let pad = 0.75
  if (o.pinned) pad += 0.875
  if (o.viewsLabel) pad += 1
  if (o.mine) pad += 1.125
  if (o.mine && o.readState === 'read' && o.readCount > 0) pad += 0.375 * String(o.readCount).length
  return {
    // Строка CSS в кавычках: `content: var(--meta-text)` печатает её как текст.
    '--meta-text': JSON.stringify(text),
    '--meta-pad': `${pad}rem`,
  } as CSSProperties
}

/**
 * Классы обёртки текста, которые ставят псевдоэлемент-распорку в конец последнего абзаца.
 * Последний блок не абзац (список, код, цитата) — мета уходит на свою строку: под неё
 * резервируется высота снизу.
 */
export const META_SPACER_CLASS = cn(
  '[&_.message-md>p:last-child]:after:inline-block [&_.message-md>p:last-child]:after:content-(--meta-text) [&_.message-md>p:last-child]:after:invisible',
  '[&_.message-md>p:last-child]:after:pl-(--meta-pad) [&_.message-md>p:last-child]:after:text-[0.6875rem] [&_.message-md>p:last-child]:after:leading-none',
  '[&:has(.message-md>:last-child:not(p))]:pb-4',
)

export function MessageMeta({
  createdAt,
  edited,
  pinned,
  mine,
  readState,
  readCount,
  locale,
  variant,
  onRetry,
  views,
}: MessageMetaProps) {
  const t = useTranslations('Chats')
  const time = messageTime(createdAt, locale)
  // В плашке на медиа и в капсуле фон всегда свой — прозрачность текста там не нужна.
  const dim = variant === 'text' || variant === 'flow' ? 'opacity-70' : ''
  return (
    <span
      className={cn(
        'pointer-events-auto flex shrink-0 items-center gap-0.5 text-[0.6875rem] leading-none whitespace-nowrap select-none',
        variant === 'text' && 'absolute right-2 bottom-1.5',
        variant === 'flow' && 'ml-auto self-end pb-0.5',
        // Подпись на медиа — исключение из правила теней и токенов (DESIGN_SYSTEM §2.2, §5.2):
        // подложка медиа всегда тёмная, текст на ней всегда белый.
        variant === 'media' &&
          'absolute right-1.5 bottom-1.5 z-10 rounded-full bg-black/45 px-1.5 py-1 text-white',
        variant === 'float' &&
          'absolute right-0 -bottom-0.5 rounded-full bg-muted/90 px-1.5 py-1 text-muted-foreground backdrop-blur',
      )}
    >
      {views !== undefined && (
        <span
          className={cn('mr-1 flex items-center gap-0.5 tabular-nums', dim)}
          title={t('tgMessage.views', { count: views })}
        >
          <Eye className="size-3" aria-hidden />
          <span aria-hidden>{formatViews(views, locale)}</span>
          <span className="sr-only">{t('tgMessage.views', { count: views })}</span>
        </span>
      )}
      {pinned && <Pin className={cn('mr-0.5 size-2.5', dim)} aria-label={t('pinnedMessage')} />}
      {edited && <span className={cn('mr-1', dim)}>{t('tgBubbles.edited')}</span>}
      <time dateTime={createdAt} className={cn('tabular-nums', dim)}>
        {time}
      </time>
      {mine && readState === 'pending' && (
        <Loader2 className={cn('ml-0.5 size-3.5 animate-spin', dim)} aria-label={t('sending')} />
      )}
      {mine && readState === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={t('sendFailedRetry')}
          title={t('sendFailedRetry')}
          className="ml-0.5 rounded-full"
        >
          <AlertCircle className="size-3.5 text-destructive" aria-hidden />
        </button>
      )}
      {/* Галочки как в Telegram: одна — ушло, две — прочитано. Промежуточное «доставлено»
          (собеседник в сети) отдельной формы не имеет — у Telegram её нет. */}
      {mine && (readState === 'sent' || readState === 'delivered') && (
        <Check className={cn('ml-0.5 size-3.5', dim)} aria-label={t('tgBubbles.statusSent')} />
      )}
      {mine && readState === 'read' && (
        <span
          className="ml-0.5 flex items-center gap-0.5"
          title={readCount > 0 ? t('readByCount', { count: readCount }) : undefined}
        >
          <CheckCheck className="size-3.5" aria-label={t('tgBubbles.statusRead')} />
          {readCount > 0 && <span className="tabular-nums">{readCount}</span>}
        </span>
      )}
    </span>
  )
}
