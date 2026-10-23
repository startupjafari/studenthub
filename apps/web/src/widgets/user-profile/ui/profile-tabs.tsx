'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { PROFILE_LIST_LIMITS } from '@studenthub/shared-schemas'
import {
  BarChart3,
  FileText,
  Image as ImageIcon,
  Newspaper,
  Settings,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react'
import {
  fetchProfileArticles,
  fetchProfileCounts,
  fetchProfileMedia,
  profileContentKeys,
} from '../../../entities/profile-content'
import { fetchPollsByUser, pollKeys } from '../../../entities/poll'
import { useScrollRow } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ProfilePosts, authorPostsQuery } from './profile-posts'
import { ProfileMediaGrid } from './profile-media-grid'
import { ProfileArticles } from './profile-articles'
import { ProfilePolls } from './profile-polls'
import type { ContentModeration } from '../lib/content-moderation'

export type ProfileTabId =
  'profile' | 'posts' | 'photos' | 'videos' | 'articles' | 'polls' | 'settings'

// Сигнал быстрого создания из меню «+»: target — целевая вкладка, n — nonce (меняется при каждом клике).
export interface CreateSignal {
  target: ProfileTabId
  n: number
}

interface ProfileTabsProps {
  userId: string
  isOwner: boolean
  // Что смотрящий-модератор может снять в чужом профиле (пункты «Удалить (модерация)»).
  moderation?: ContentModeration
  tab: ProfileTabId
  onTabChange: (tab: ProfileTabId) => void
  // Контент вкладки «Профиль» (карточки профиля или форма редактирования).
  children: ReactNode
  // Опциональная вкладка «Настройки» (только для владельца).
  settings?: ReactNode
  createSignal?: CreateSignal | null
  onCreateConsumed?: () => void
  // Переключение вкладок заблокировано (например, идёт редактирование профиля).
  locked?: boolean
  // Шапка профиля над табами; в режиме locked закрепляется вместе с табами (скролл — только контент).
  stickyTop?: ReactNode
  // Вкладки контента (посты, фото, видео, статьи, опросы). У охраны и библиотекаря их нет
  // (docs/PROJECT.md §2): остаются «Профиль» и «Настройки», а списки не запрашиваются.
  content?: boolean
}

export function ProfileTabs({
  userId,
  isOwner,
  moderation,
  tab,
  onTabChange,
  children,
  settings,
  createSignal,
  onCreateConsumed,
  locked = false,
  stickyTop,
  content = true,
}: ProfileTabsProps) {
  const t = useTranslations('Profile')

  // Счётчики для бейджей на табах. Ключи совпадают с ключами вкладок-контента,
  // поэтому запросы шарят кэш с ProfilePosts/MediaGrid/Articles/Polls (без двойной загрузки).
  // Посты — вид вкладки по умолчанию: его `total` — все видимые посты автора.
  const postsQ = useInfiniteQuery({ ...authorPostsQuery(userId), enabled: content })
  const mediaQ = useQuery({
    queryKey: profileContentKeys.media(userId),
    queryFn: () => fetchProfileMedia(userId),
    enabled: content,
  })
  const articlesQ = useQuery({
    queryKey: profileContentKeys.articles(userId),
    queryFn: () => fetchProfileArticles(userId),
    enabled: content,
  })
  const pollsQ = useQuery({
    queryKey: pollKeys.byUser(userId),
    queryFn: () => fetchPollsByUser(userId),
    enabled: content,
  })

  // Медиа, статьи и опросы приходят списком с потолком: пока список короче потолка, его
  // длина и есть итог; дошёл до потолка — итог берётся с сервера (иначе бейдж показал бы
  // 300 фото у автора с тысячей). Обычному профилю лишний запрос не нужен.
  const media = mediaQ.data
  const capped =
    (media?.length ?? 0) >= PROFILE_LIST_LIMITS.media ||
    (articlesQ.data?.length ?? 0) >= PROFILE_LIST_LIMITS.articles ||
    (pollsQ.data?.length ?? 0) >= PROFILE_LIST_LIMITS.polls
  const totalsQ = useQuery({
    // Версия списков в ключе: загрузка, удаление и новая запись меняют список — итоги
    // перечитываются вместе с ним, а прежние держатся на бейдже до ответа.
    queryKey: [
      ...profileContentKeys.counts(userId),
      mediaQ.dataUpdatedAt,
      articlesQ.dataUpdatedAt,
      pollsQ.dataUpdatedAt,
    ],
    queryFn: () => fetchProfileCounts(userId),
    enabled: capped,
    placeholderData: keepPreviousData,
  })
  const totals = totalsQ.data
  // Число из списка, если он не упёрся в потолок, иначе — итог с сервера (пока его нет,
  // бейдж не показываем: число с потолком выдавало бы себя за итог).
  const badge = (
    listed: number | undefined,
    length: number | undefined,
    cap: number,
    total?: number,
  ) => (length === undefined ? undefined : length < cap ? listed : total)
  const counts: Partial<Record<ProfileTabId, number>> = {
    posts: postsQ.data?.pages[0]?.total,
    photos: badge(
      media?.filter((m) => m.type === 'PHOTO').length,
      media?.length,
      PROFILE_LIST_LIMITS.media,
      totals?.photos,
    ),
    videos: badge(
      media?.filter((m) => m.type === 'VIDEO').length,
      media?.length,
      PROFILE_LIST_LIMITS.media,
      totals?.videos,
    ),
    articles: badge(
      articlesQ.data?.length,
      articlesQ.data?.length,
      PROFILE_LIST_LIMITS.articles,
      totals?.articles,
    ),
    polls: badge(
      pollsQ.data?.length,
      pollsQ.data?.length,
      PROFILE_LIST_LIMITS.polls,
      totals?.polls,
    ),
  }

  const tabs: { id: ProfileTabId; label: string; icon: LucideIcon }[] = [
    { id: 'profile', label: t('tabProfile'), icon: UserRound },
    ...(content
      ? [
          { id: 'posts' as const, label: t('tabPosts'), icon: Newspaper },
          { id: 'photos' as const, label: t('tabPhotos'), icon: ImageIcon },
          { id: 'videos' as const, label: t('tabVideos'), icon: Video },
          { id: 'articles' as const, label: t('tabArticles'), icon: FileText },
          { id: 'polls' as const, label: t('tabPolls'), icon: BarChart3 },
        ]
      : []),
    ...(settings ? [{ id: 'settings' as const, label: t('settings'), icon: Settings }] : []),
  ]

  // Семь вкладок профиля в телефон не влезают: ряд тянется пальцем и мышью, у краёв
  // затухает, а выбранная вкладка сама подъезжает в видимую зону (use-scroll-row).
  const row = useScrollRow<HTMLDivElement>()
  const { reveal } = row
  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    reveal(activeTabRef.current)
  }, [tab, reveal])

  const sigFor = (target: ProfileTabId) =>
    createSignal && createSignal.target === target ? createSignal.n : undefined

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Шапка + табы над контентом (скроллятся вместе со страницей). */}
      <div className="flex flex-col gap-4">
        {stickyTop}
        <div
          ref={row.ref}
          role="tablist"
          aria-label={t('title')}
          className={cn(
            'flex gap-1 overflow-x-auto rounded-2xl border border-border bg-muted/50 p-1 sm:grid sm:rounded-xl',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            row.overflowing && 'cursor-grab',
            row.dragging && 'cursor-grabbing select-none',
          )}
          style={{
            gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
            maskImage: row.fadeMask,
            WebkitMaskImage: row.fadeMask,
          }}
        >
          {tabs.map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            const count = counts[item.id]
            return (
              <button
                key={item.id}
                ref={active ? activeTabRef : undefined}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={count !== undefined ? `${item.label} (${count})` : item.label}
                disabled={locked}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-medium transition-colors sm:min-h-9 sm:min-w-0 sm:shrink sm:gap-2 sm:rounded-lg sm:px-2 sm:text-sm',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  locked && 'cursor-not-allowed',
                  locked &&
                    !active &&
                    'opacity-40 hover:bg-transparent hover:text-muted-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
                {count !== undefined && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 text-xs font-semibold tabular-nums',
                      active ? 'bg-primary-foreground/20' : 'bg-foreground/10',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'profile' && children}
      {tab === 'posts' && (
        <ProfilePosts
          userId={userId}
          isOwner={isOwner}
          openCreate={sigFor('posts')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'photos' && (
        <ProfileMediaGrid
          userId={userId}
          isOwner={isOwner}
          moderation={moderation}
          kind="PHOTO"
          openPicker={sigFor('photos')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'videos' && (
        <ProfileMediaGrid
          userId={userId}
          isOwner={isOwner}
          moderation={moderation}
          kind="VIDEO"
          openPicker={sigFor('videos')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'articles' && (
        <ProfileArticles
          userId={userId}
          isOwner={isOwner}
          moderation={moderation}
          openCreate={sigFor('articles')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'polls' && (
        <ProfilePolls
          userId={userId}
          isOwner={isOwner}
          moderation={moderation}
          openCreate={sigFor('polls')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'settings' && settings}
    </div>
  )
}
