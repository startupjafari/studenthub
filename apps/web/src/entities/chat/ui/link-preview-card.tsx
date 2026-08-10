'use client'

import type { LinkPreview } from '../model/types'

// Карточка инлайн-превью ссылки под сообщением (OG-мета). Клик открывает ссылку в новой вкладке.
export function LinkPreviewCard({ preview, mine }: { preview: LinkPreview; mine: boolean }) {
  let host = ''
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`mt-1 flex max-w-sm overflow-hidden rounded-xl border ${
        mine ? 'border-primary-foreground/20 bg-primary-foreground/5' : 'border-border bg-muted/40'
      } transition-colors hover:bg-muted/70`}
    >
      {/* Цветная полоса-акцент слева (как в Telegram). */}
      <span className="w-1 shrink-0 bg-primary/60" aria-hidden />
      <div className="min-w-0 flex-1 p-2.5">
        <span className="block truncate text-[0.7rem] text-muted-foreground">
          {preview.siteName || host}
        </span>
        {preview.title && (
          <span className="mt-0.5 line-clamp-2 text-sm font-medium">{preview.title}</span>
        )}
        {preview.description && (
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {preview.description}
          </span>
        )}
        {preview.image && (
          // Внешняя картинка превью — обычный img (домен произвольный, next/image не подходит).
          <img
            src={preview.image}
            alt=""
            loading="lazy"
            className="mt-2 max-h-40 w-full rounded-lg object-cover"
          />
        )}
      </div>
    </a>
  )
}
