'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { fetchAuthorPosts } from '../../../entities/post'
import { fetchSchedule, scheduleKeys } from '../../../entities/schedule'
import type { StoryEventCard, StoryPairCard, StoryPostCard } from '../../../entities/story'
import { useAppSelector } from '../../../shared/store'
import { Modal, Skeleton } from '../../../shared/ui'

export type CardKind = 'event' | 'post' | 'schedule'

export type PickedCard =
  | { kind: 'event'; event: StoryEventCard }
  | { kind: 'post'; post: StoryPostCard }
  | { kind: 'schedule'; pair: StoryPairCard; date: string }

const TITLE_KEY = {
  event: 'pickEventTitle',
  post: 'pickPostTitle',
  schedule: 'pickPairTitle',
} as const
// Сколько своих публикаций предлагать: это быстрый выбор недавнего, а не архив.
const POSTS_LIMIT = 20

/** Ближайшая дата, когда пара с этим днём недели (ISO, 1 = пн) ещё впереди. */
function nextDate(dayOfWeek: number, endTime: string, now = new Date()): string {
  const today = ((now.getDay() + 6) % 7) + 1
  let diff = (dayOfWeek - today + 7) % 7
  const [h, m] = endTime.split(':').map(Number)
  const ended = now.getHours() * 60 + now.getMinutes() >= (h ?? 0) * 60 + (m ?? 0)
  if (diff === 0 && ended) diff = 7
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Выбор записи для карточки-стикера: ближайшие видимые мне события, мои публикации или пары
 * моего расписания (каждая — на ближайшую дату, когда она будет). Сервер при публикации
 * проверит, что запись мне доступна, а зрителям покажет её по их собственным правам.
 */
export function CardPicker({
  kind,
  onPick,
  onClose,
}: {
  kind: CardKind
  onPick: (card: PickedCard) => void
  onClose: () => void
}) {
  const t = useTranslations('Stories')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const myId = useAppSelector((s) => s.auth.user?.id)

  const events = useQuery({
    queryKey: eventKeys.list('upcoming'),
    queryFn: () => fetchEvents(),
    enabled: kind === 'event',
  })
  const posts = useQuery({
    queryKey: ['stories', 'card-picker', 'posts', myId],
    queryFn: () => fetchAuthorPosts(myId ?? '', { limit: POSTS_LIMIT }),
    enabled: kind === 'post' && !!myId,
  })
  const schedule = useQuery({
    queryKey: scheduleKeys.view({}),
    queryFn: () => fetchSchedule({}),
    enabled: kind === 'schedule',
  })
  const query = kind === 'event' ? events : kind === 'post' ? posts : schedule

  const items: { key: string; title: string; meta: string; pick: () => void }[] =
    kind === 'event'
      ? (events.data ?? []).map((e) => ({
          key: e.id,
          title: e.title,
          meta: new Date(e.startsAt).toLocaleString(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }),
          pick: () =>
            onPick({
              kind: 'event',
              event: {
                id: e.id,
                title: e.title,
                startsAt: e.startsAt,
                endsAt: e.endsAt,
                location: e.location,
                isOnline: e.isOnline,
                isRegistered: false,
              },
            }),
        }))
      : kind === 'post'
        ? (posts.data?.items ?? []).map((p) => ({
            key: p.id,
            title: p.title ?? p.content.slice(0, 80),
            meta: new Date(p.createdAt).toLocaleDateString(locale),
            pick: () =>
              onPick({
                kind: 'post',
                post: {
                  id: p.id,
                  authorId: p.authorId,
                  authorName: `${p.author.lastName} ${p.author.firstName}`,
                  title: p.title,
                  excerpt: p.content.slice(0, 160),
                },
              }),
          }))
        : (schedule.data?.pairs ?? [])
            .map((p) => ({ p, date: nextDate(p.dayOfWeek, p.endTime) }))
            .sort((a, b) => `${a.date}${a.p.startTime}`.localeCompare(`${b.date}${b.p.startTime}`))
            .map(({ p, date }) => ({
              key: `${p.id}:${date}`,
              title: p.subject,
              meta: `${new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })} · ${p.startTime}–${p.endTime}${p.room ? ` · ${p.room.name}` : ''}`,
              pick: () =>
                onPick({
                  kind: 'schedule',
                  date,
                  pair: {
                    id: p.id,
                    subject: p.subject,
                    startTime: p.startTime,
                    endTime: p.endTime,
                    room: p.room?.name ?? null,
                    group: '',
                  },
                }),
            }))

  return (
    <Modal onClose={onClose} title={t(TITLE_KEY[kind])} size="md">
      {query.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{tErr('INTERNAL_ERROR')}</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('pickEmpty')}</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={item.pick}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="line-clamp-1 text-sm font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.meta}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
