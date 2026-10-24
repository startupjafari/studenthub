'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { STORIES_ENABLED } from '../../../shared/config'
import { cn } from '../../../shared/lib/utils'
import { Avatar, AvatarFallback, AvatarImage, Modal, Skeleton } from '../../../shared/ui'
import { CreateStoryForm } from '../../../features/create-story'
import { canCreateStory, fetchStories, storyKeys, type StoryRing } from '../../../entities/story'
import { StoryViewer } from './story-viewer'

/**
 * Лента колец над основной лентой.
 *
 * Пока раздел за флагом раскатки (`NEXT_PUBLIC_FEATURE_STORIES`), поэтому проверка стоит
 * и здесь, а не только на месте вызова: виджет не должен ходить в сеть там, где функции
 * ещё нет. Пустая выдача без права публиковать не рисует ничего — полоса-заглушка над
 * лентой занимала бы первый экран ради сообщения «тут пусто».
 */
export function StoriesRail() {
  const t = useTranslations('Stories')
  const role = useAppSelector((s) => s.auth.role)
  const myId = useAppSelector((s) => s.auth.user?.id)
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: storyKeys.feed(),
    queryFn: () => fetchStories(),
    enabled: STORIES_ENABLED,
    // Сторисы живут сутки, но лента колец должна обновляться чаще, чем раз в сессию:
    // минута — компромисс между свежестью и лишними запросами на каждом возврате к ленте.
    staleTime: 60 * 1000,
  })

  if (!STORIES_ENABLED) return null

  const rings = data ?? []
  const canPost = canCreateStory(role)
  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-hidden px-1 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex w-16 flex-col items-center gap-1.5">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    )
  }
  if (rings.length === 0 && !canPost) return null

  return (
    <>
      {/* Горизонтальная полоса: на телефоне листается пальцем, на десктопе — колесом с shift.
          Полосы прокрутки нет (scrollbar-none), как в мессенджерах. */}
      <div className="flex gap-3 overflow-x-auto px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {canPost && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center"
          >
            <span className="flex size-14 items-center justify-center rounded-full border border-dashed border-border bg-muted text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              <Plus className="size-5" aria-hidden />
            </span>
            <span className="w-full truncate text-xs text-muted-foreground">{t('yourStory')}</span>
          </button>
        )}

        {rings.map((ring, index) => (
          <RingButton
            key={ring.author.id}
            ring={ring}
            isMe={ring.author.id === myId}
            onOpen={() => setViewerAt(index)}
          />
        ))}
      </div>

      {viewerAt !== null && rings[viewerAt] && (
        <StoryViewer rings={rings} startIndex={viewerAt} onClose={() => setViewerAt(null)} />
      )}

      {createOpen && (
        <Modal
          onClose={() => setCreateOpen(false)}
          title={t('newStory')}
          size="2xl"
          className="max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-none"
        >
          <CreateStoryForm onCreated={() => setCreateOpen(false)} />
        </Modal>
      )}
    </>
  )
}

function RingButton({
  ring,
  isMe,
  onOpen,
}: {
  ring: StoryRing
  isMe: boolean
  onOpen: () => void
}) {
  const t = useTranslations('Stories')
  const name = isMe ? t('yourStory') : ring.author.firstName
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('openStoryOf', { name: `${ring.author.firstName} ${ring.author.lastName}` })}
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center"
    >
      {/* Кольцо: яркое у непросмотренных, приглушённое у просмотренных — единственный
          признак, по которому в этом формате отличают новое от уже увиденного. */}
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-full p-[2px]',
          ring.hasUnseen
            ? 'bg-gradient-to-br from-primary via-indigo-500 to-violet-500'
            : 'bg-border',
        )}
      >
        <Avatar className="size-full border-2 border-background">
          {ring.author.avatarUrl && <AvatarImage src={ring.author.avatarUrl} alt="" />}
          <AvatarFallback>
            {ring.author.firstName.charAt(0)}
            {ring.author.lastName.charAt(0)}
          </AvatarFallback>
        </Avatar>
      </span>
      <span className="w-full truncate text-xs text-muted-foreground">{name}</span>
    </button>
  )
}
