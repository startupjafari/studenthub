'use client'

import { useTranslations } from 'next-intl'
import { Link2, X } from 'lucide-react'
import type { LinkPreview } from '../../../entities/chat'
import { cn } from '../../../shared/lib/utils'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Превью ссылки над полем ввода до отправки (Telegram WebPagePreview): сайт и заголовок
 * акцентом, описание — строкой ниже, крестик — отправить без превью. Тот же строй, что у
 * плашек ответа и правки: значок · полоса-акцент · текст · крестик.
 *
 * Картинки нет намеренно (F-F29): её адрес — на чужом сайте, и загрузка отдала бы владельцу
 * ссылки адрес и время человека. Под отправленным сообщением её тоже нет.
 */
export function ComposerLinkPreview({
  preview,
  className,
  onDismiss,
}: {
  preview: LinkPreview
  className?: string
  onDismiss: () => void
}) {
  const t = useTranslations('Chats')
  const site = preview.siteName || hostOf(preview.url)
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-2xl px-3 py-2 duration-200 animate-in fade-in slide-in-from-bottom-2 lg:rounded-md',
        className,
      )}
    >
      <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="h-8 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-primary">
          {preview.title ?? site}
        </span>
        <p className="truncate text-xs text-muted-foreground">{preview.description ?? site}</p>
      </div>
      <button
        type="button"
        aria-label={t('tgComposer2.linkPreviewRemove')}
        title={t('tgComposer2.linkPreviewRemove')}
        onClick={onDismiss}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
