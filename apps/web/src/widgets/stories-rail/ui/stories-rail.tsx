'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
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
  const tCommon = useTranslations('Common')
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

  // Стрелки прокрутки ряда на десктопе: колёсиком горизонтальный ряд листают только с
  // shift, и без стрелок дальние кольца мышью было не достать. Каждая видна, только когда
  // в её сторону есть куда листать.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measureEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }, [])
  useEffect(() => {
    measureEdges()
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measureEdges, data])
  const scrollBy = (dir: -1 | 1): void => {
    const el = scrollerRef.current
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  if (!STORIES_ENABLED) return null

  const rings = data ?? []
  const canPost = canCreateStory(role)
  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-hidden px-1 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex w-20 flex-col items-center gap-2">
            <Skeleton className="size-[4.5rem] rounded-full" />
            <Skeleton className="h-3 w-14" />
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
      <div className="group/rail relative">
        <div
          ref={scrollerRef}
          onScroll={measureEdges}
          className="flex gap-4 overflow-x-auto scroll-smooth px-1 py-2 [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
        >
          {canPost && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="group flex w-20 shrink-0 flex-col items-center gap-2 rounded-xl text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {/* Кнопка создания читается сразу: акцентный плюс на мягкой подложке, а не
                серый пунктир, который сливался с пустым местом. */}
              <span className="flex size-[4.5rem] items-center justify-center rounded-full border-2 border-dashed border-primary/40 bg-primary/10 text-primary transition-[background-color,border-color,transform] duration-150 group-hover:border-primary group-hover:bg-primary/15 group-active:scale-95 motion-reduce:transition-none">
                <Plus className="size-6" aria-hidden />
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">{t('newStory')}</span>
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
        {(['left', 'right'] as const).map((side) =>
          edges[side] ? (
            <button
              key={side}
              type="button"
              aria-label={side === 'left' ? tCommon('previous') : tCommon('next')}
              onClick={() => scrollBy(side === 'left' ? -1 : 1)}
              className={cn(
                'absolute top-[2.6rem] z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm transition-[opacity,background-color] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:flex',
                'opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100',
                side === 'left' ? 'left-0' : 'right-0',
              )}
            >
              {side === 'left' ? (
                <ChevronLeft className="size-4" aria-hidden />
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
            </button>
          ) : null,
        )}
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
      className="group flex w-20 shrink-0 flex-col items-center gap-2 rounded-xl text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {/* Кольцо: яркое у непросмотренных, приглушённое у просмотренных — единственный
          признак, по которому в этом формате отличают новое от уже увиденного. */}
      <span
        className={cn(
          'flex size-[4.5rem] items-center justify-center rounded-full p-[3px] transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-95 motion-reduce:transition-none',
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
      <span
        className={cn(
          'w-full truncate text-xs transition-colors duration-150 group-hover:text-foreground',
          ring.hasUnseen ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
        title={name}
      >
        {name}
      </span>
    </button>
  )
}
