'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ListTree } from 'lucide-react'
import { prefersReducedMotion } from '../../../shared/lib/spring'
import { cn } from '../../../shared/lib/utils'
import type { TocItem } from '../lib/article-toc'

/** Полоса «читаемого» раздела: от шапки до трети экрана. */
const READING_BAND = '-80px 0px -66% 0px'

/**
 * Раздел, который сейчас читают. IntersectionObserver вместо замеров на каждую прокрутку:
 * браузер сам сообщает, когда заголовок входит в полосу у верха экрана, — и никаких
 * вычислений раскладки в кадре прокрутки.
 */
export function useActiveHeading(slugs: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(slugs[0] ?? null)
  const key = slugs.join('|')

  useEffect(() => {
    const list = key ? key.split('|') : []
    if (list.length === 0 || typeof IntersectionObserver === 'undefined') return
    const inBand = new Map<string, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) inBand.set(e.target.id, e.isIntersecting)
        const first = list.find((slug) => inBand.get(slug))
        if (first) {
          setActive(first)
          return
        }
        // В полосе заголовка нет (длинный раздел): читают последний ушедший выше неё.
        let above: string | null = null
        for (const slug of list) {
          const el = document.getElementById(slug)
          if (el && el.getBoundingClientRect().top < 80) above = slug
        }
        if (above) setActive(above)
      },
      { rootMargin: READING_BAND },
    )
    for (const slug of list) {
      const el = document.getElementById(slug)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [key])

  return active
}

/** Перейти к разделу: плавно (если движение не отключено) и с якорем в адресе. */
export function scrollToSection(slug: string): void {
  const el = document.getElementById(slug)
  if (!el) return
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  window.history.replaceState(window.history.state, '', `#${encodeURIComponent(slug)}`)
}

/**
 * Содержание статьи из её заголовков. На компьютере — колонка рядом с текстом (липкая,
 * её ставит страница), на телефоне — сворачиваемый блок над текстом: раскрытым он отодвигал
 * бы начало статьи на экран вниз.
 */
export function ArticleTableOfContents({
  items,
  variant,
  className,
}: {
  items: readonly TocItem[]
  variant: 'aside' | 'inline'
  className?: string
}) {
  const t = useTranslations('Article')
  const active = useActiveHeading(items.map((h) => h.slug))
  const [open, setOpen] = useState(false)
  const minLevel = Math.min(...items.map((h) => h.level))

  const list = (
    <ul className="flex flex-col">
      {items.map((h) => {
        const current = active === h.slug
        return (
          <li key={h.slug}>
            <a
              href={`#${encodeURIComponent(h.slug)}`}
              aria-current={current ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault()
                scrollToSection(h.slug)
                setOpen(false)
              }}
              style={{ paddingLeft: `${0.75 + (h.level - minLevel) * 0.875}rem` }}
              className={cn(
                '-ml-px block border-l-2 py-1.5 pr-2 text-sm leading-snug transition-colors duration-150',
                current
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {h.text}
            </a>
          </li>
        )
      })}
    </ul>
  )

  if (variant === 'aside') {
    return (
      <nav aria-label={t('tableOfContents')} className={className}>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('tableOfContents')}
        </p>
        <div className="border-l border-border">{list}</div>
      </nav>
    )
  }

  return (
    <nav aria-label={t('tableOfContents')} className={cn('rounded-xl bg-muted/50', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ListTree className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-left">{t('tableOfContents')}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
        <ChevronDown
          className={cn('size-4 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && <div className="border-l border-border mx-4 mb-3">{list}</div>}
    </nav>
  )
}
