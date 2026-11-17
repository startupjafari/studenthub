'use client'

import { useState } from 'react'
import type { LinkPreview } from '../../../entities/chat'
import { cn } from '../../../shared/lib/utils'

/** Картинка уже этой ширины (px) — миниатюрой справа от текста, а не во всю ширину. */
const SMALL_IMAGE_PX = 300

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Превью ссылки внутри пузыря (Telegram): плашка с полосой акцента слева, имя сайта цветом
 * акцента, заголовок жирным, описание, ниже — картинка во всю ширину плашки. Маленькая
 * картинка (иконка сайта, квадратный логотип) встаёт миниатюрой справа от текста.
 * Пока картинка не пришла, место под неё держится по пропорции OG-обложки (1.91:1), потом —
 * по её собственной.
 */
export function MessageWebPage({ preview, mine }: { preview: LinkPreview; mine: boolean }) {
  const [image, setImage] = useState<'loading' | 'large' | 'small' | 'failed'>(
    preview.image ? 'loading' : 'failed',
  )
  // Пропорция пришедшей картинки: обложка видна целиком, высота — не больше 1.25 ширины.
  const [ratio, setRatio] = useState(1.91)
  const site = preview.siteName || hostOf(preview.url)
  const thumb = image === 'small'
  const img = preview.image && image !== 'failed' && (
    // Внешняя картинка превью — обычный img (домен произвольный, next/image не подходит).
    <img
      src={preview.image}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        if (h > 0) setRatio(Math.min(2.5, Math.max(0.8, w / h)))
        setImage(w < SMALL_IMAGE_PX ? 'small' : 'large')
      }}
      onError={() => setImage('failed')}
      className={cn(
        'rounded-sm object-cover',
        thumb ? 'size-14 shrink-0' : 'mt-1.5 block w-full',
        image === 'loading' && (mine ? 'bg-primary-foreground/10' : 'bg-foreground/5'),
      )}
      style={thumb ? undefined : { aspectRatio: ratio }}
    />
  )
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        'mt-1 mb-0.5 flex max-w-full min-w-0 overflow-hidden rounded-sm text-[0.8125rem] leading-snug',
        mine
          ? 'bg-primary-foreground/15 hover:bg-primary-foreground/25'
          : 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <span
        aria-hidden
        className={cn('w-[3px] shrink-0', mine ? 'bg-primary-foreground' : 'bg-primary')}
      />
      <span className={cn('min-w-0 flex-1 py-1.5 pr-2 pl-2', thumb && 'flex gap-2')}>
        <span className="block min-w-0 flex-1">
          {site && (
            <span
              className={cn(
                'block truncate font-semibold',
                mine ? 'text-primary-foreground' : 'text-primary',
              )}
            >
              {site}
            </span>
          )}
          {preview.title && <span className="line-clamp-2 font-semibold">{preview.title}</span>}
          {preview.description && (
            <span className={cn('line-clamp-3', mine ? 'opacity-90' : 'text-foreground/80')}>
              {preview.description}
            </span>
          )}
        </span>
        {img}
      </span>
    </a>
  )
}
