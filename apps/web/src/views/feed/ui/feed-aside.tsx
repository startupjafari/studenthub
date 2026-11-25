'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, MapPin, Pin, Video } from 'lucide-react'
import type { EventItem } from '../../../entities/event'
import type { FeedPost } from '../../../entities/post'
import { Card, CardContent, CardHeader, CardTitle } from '../../../shared/ui'
import { plainPreview } from '../../../shared/lib'

/**
 * Ближайшие события вуза — компактными строками: название, когда и где. Пустой блок не
 * рисуется вовсе (решает страница): «событий нет» в боковой колонке ничего не сообщает.
 */
export function UpcomingEventsCard({ events }: { events: readonly EventItem[] }) {
  const t = useTranslations('Dashboard')
  const locale = useLocale()
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 shrink-0 text-primary" aria-hidden />
          {t('upcomingEvents')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="-mx-2 flex flex-col">
          {events.map((e) => (
            <li key={e.id}>
              <Link
                href={`/events/${e.id}`}
                className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className="line-clamp-2 leading-snug font-medium break-words">{e.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <time dateTime={e.startsAt} className="shrink-0">
                    {new Date(e.startsAt).toLocaleString(locale, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {e.isOnline ? (
                    <span className="inline-flex items-center gap-1">
                      <Video className="size-3" aria-hidden />
                      {t('online')}
                    </span>
                  ) : (
                    e.location && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin className="size-3 shrink-0" aria-hidden />
                        <span className="truncate">{e.location}</span>
                      </span>
                    )
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Важные объявления — закреплённые посты (тот же срез, что у вкладки «Важное»): заголовок или
 * начало текста. Ведёт на страницу поста.
 */
export function ImportantPostsCard({ posts }: { posts: readonly FeedPost[] }) {
  const t = useTranslations('Feed')
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pin className="size-4 shrink-0 text-primary" aria-hidden />
          {t('filterImportant')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="-mx-2 flex flex-col">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/posts/${p.id}`}
                className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span className="line-clamp-2 leading-snug font-medium break-words">
                  {p.title || plainPreview(p.content, { chatMarkup: false })}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {p.universityPage?.name ?? `${p.author.lastName} ${p.author.firstName}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
