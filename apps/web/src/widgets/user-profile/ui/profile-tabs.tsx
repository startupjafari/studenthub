'use client'

import type { ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
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
import { fetchAuthorPosts, postKeys } from '../../../entities/post'
import {
  fetchProfileArticles,
  fetchProfileMedia,
  profileContentKeys,
} from '../../../entities/profile-content'
import { fetchPollsByUser, pollKeys } from '../../../entities/poll'
import { cn } from '../../../shared/lib/utils'
import { ProfilePosts } from './profile-posts'
import { ProfileMediaGrid } from './profile-media-grid'
import { ProfileArticles } from './profile-articles'
import { ProfilePolls } from './profile-polls'

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
}

export function ProfileTabs({
  userId,
  isOwner,
  tab,
  onTabChange,
  children,
  settings,
  createSignal,
  onCreateConsumed,
  locked = false,
  stickyTop,
}: ProfileTabsProps) {
  const t = useTranslations('Profile')

  // Счётчики для бейджей на табах. Ключи совпадают с ключами вкладок-контента,
  // поэтому запросы шарят кэш с ProfilePosts/MediaGrid/Articles/Polls (без двойной загрузки).
  const postsQ = useInfiniteQuery({
    queryKey: postKeys.author(userId),
    queryFn: ({ pageParam }) => fetchAuthorPosts(userId, { limit: 20, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const mediaQ = useQuery({
    queryKey: profileContentKeys.media(userId),
    queryFn: () => fetchProfileMedia(userId),
  })
  const articlesQ = useQuery({
    queryKey: profileContentKeys.articles(userId),
    queryFn: () => fetchProfileArticles(userId),
  })
  const pollsQ = useQuery({
    queryKey: pollKeys.byUser(userId),
    queryFn: () => fetchPollsByUser(userId),
  })

  const media = mediaQ.data
  const counts: Partial<Record<ProfileTabId, number>> = {
    posts: postsQ.data?.pages[0]?.total,
    photos: media ? media.filter((m) => m.type === 'PHOTO').length : undefined,
    videos: media ? media.filter((m) => m.type === 'VIDEO').length : undefined,
    articles: articlesQ.data?.length,
    polls: pollsQ.data?.length,
  }

  const tabs: { id: ProfileTabId; label: string; icon: LucideIcon }[] = [
    { id: 'profile', label: t('tabProfile'), icon: UserRound },
    { id: 'posts', label: t('tabPosts'), icon: Newspaper },
    { id: 'photos', label: t('tabPhotos'), icon: ImageIcon },
    { id: 'videos', label: t('tabVideos'), icon: Video },
    { id: 'articles', label: t('tabArticles'), icon: FileText },
    { id: 'polls', label: t('tabPolls'), icon: BarChart3 },
    ...(settings ? [{ id: 'settings' as const, label: t('settings'), icon: Settings }] : []),
  ]

  const sigFor = (target: ProfileTabId) =>
    createSignal && createSignal.target === target ? createSignal.n : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка + табы над контентом (скроллятся вместе со страницей). */}
      <div className="flex flex-col gap-4">
        {stickyTop}
        <div
          role="tablist"
          aria-label={t('title')}
          className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/50 p-1 sm:grid"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            const count = counts[item.id]
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={count !== undefined ? `${item.label} (${count})` : item.label}
                disabled={locked}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:min-w-0 sm:shrink sm:gap-2 sm:px-2 sm:py-2 sm:text-sm',
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
          kind="PHOTO"
          openPicker={sigFor('photos')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'videos' && (
        <ProfileMediaGrid
          userId={userId}
          isOwner={isOwner}
          kind="VIDEO"
          openPicker={sigFor('videos')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'articles' && (
        <ProfileArticles
          userId={userId}
          isOwner={isOwner}
          openCreate={sigFor('articles')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'polls' && (
        <ProfilePolls
          userId={userId}
          isOwner={isOwner}
          openCreate={sigFor('polls')}
          onConsumed={onCreateConsumed}
        />
      )}
      {tab === 'settings' && settings}
    </div>
  )
}
