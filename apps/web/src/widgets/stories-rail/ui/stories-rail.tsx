'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import { STORIES_ENABLED } from '../../../shared/config'
import { useLiveRefresh } from '../../../shared/realtime'
import { useFreshIds } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from '../../../shared/ui'
import { canCreateStory, fetchStories, storyKeys, type StoryRing } from '../../../entities/story'

// Просмотр и редактор сторис — отдельными чанками (задача 21.B4): полоса колец стоит над
// лентой главной, а оба окна открываются только по нажатию. Статический импорт отдавал
// главной ~100 КБ кода просмотрщика и редактора до первой отрисовки.
const StoryViewer = dynamic(() => import('./story-viewer').then((m) => m.StoryViewer), {
  ssr: false,
})
const CreateStoryForm = dynamic(
  () => import('../../../features/create-story').then((m) => m.CreateStoryForm),
  { ssr: false },
)

/**
 * Лента колец над основной лентой.
 *
 * Раздел за флагом раскатки (`NEXT_PUBLIC_FEATURE_STORIES`), поэтому проверка стоит
 * и здесь, а не только на месте вызова: виджет не должен ходить в сеть там, где функции
 * ещё нет. Пустая выдача без права публиковать не рисует ничего — полоса-заглушка над
 * лентой занимала бы первый экран ради сообщения «тут пусто».
 */
// Поверхность и ряд полосы — общие у колец и у их заготовки.
// Без своей карточки: полоса колец — часть ленты, как в Instagram. Карточка вокруг одной
// кнопки «Новая сторис» (сторис ещё ни у кого нет) читалась большим пустым блоком.
// Ячейка шире кольца (5.25rem против 4rem), чтобы подпись «Новая сторис» не обрезалась.
const RAIL_SURFACE = 'max-sm:-mx-3'
const RAIL_ROW = 'flex gap-1 px-1 py-1'
// Кольцо — 64px (4rem), ячейка — с запасом под подпись.
const RING = 'size-16'
const CELL = 'w-[5.25rem]'

export function StoriesRail() {
  const t = useTranslations('Stories')
  const tCommon = useTranslations('Common')
  const role = useAppSelector((s) => s.auth.role)
  const me = useAppSelector((s) => s.auth.user)
  const myId = me?.id
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

  // Живые кольца (§9.2d): у однокурсника появилась или пропала история — полоса
  // перечитывается сама. Пока открыт просмотр, кольца не трогаем: он листает тот же
  // массив по номеру, и новое кольцо перед текущим перескочило бы на чужую историю.
  // Пропущенный сигнал отыгрывается при закрытии просмотра.
  const qc = useQueryClient()
  const viewerOpen = viewerAt !== null
  const viewerOpenRef = useRef(viewerOpen)
  viewerOpenRef.current = viewerOpen
  const missedRef = useRef(false)
  useLiveRefresh(
    REALTIME_EVENTS.storiesChanged,
    () => {
      if (!viewerOpenRef.current) return [storyKeys.feed()]
      missedRef.current = true
      return null
    },
    { enabled: STORIES_ENABLED },
  )
  useEffect(() => {
    if (viewerOpen || !missedRef.current) return
    missedRef.current = false
    void qc.invalidateQueries({ queryKey: storyKeys.feed() })
  }, [viewerOpen, qc])

  // Новое кольцо въезжает с подсветкой. Ключ из id — чтобы перечитывание с теми же
  // кольцами не перезапускало отсчёт; метка-точка отсчёта — для пустой полосы.
  const ringsLoaded = data !== undefined
  const ringKey = (data ?? []).map((r) => r.author.id).join('|')
  const ringIds = useMemo(
    () => (ringsLoaded ? ['rail', ...ringKey.split('|').filter(Boolean)] : undefined),
    [ringKey, ringsLoaded],
  )
  const freshRings = useFreshIds(ringIds)

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
    // Заготовка повторяет полосу один в один (поверхность, поля, шаг колец) — когда кольца
    // придут, лента под ней не сдвинется.
    return (
      <div className={RAIL_SURFACE} aria-hidden>
        <div className={cn(RAIL_ROW, 'overflow-hidden')}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={cn(CELL, 'flex shrink-0 flex-col items-center gap-1.5')}>
              <Skeleton className={cn(RING, 'rounded-full')} />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (rings.length === 0 && !canPost) return null

  return (
    <>
      {/* Горизонтальная полоса: на телефоне листается пальцем, на десктопе — колесом с shift
          и стрелками. Полосы прокрутки нет (scrollbar-none), как в мессенджерах.

          Полоса — на той же поверхности, что и посты (rounded-xl, ring-foreground/10), и
          её края совпадают с краями карточек: кольца без подложки висели в воздухе, а
          первое стояло на 4px левее аватаров в постах. */}
      <div className={cn(RAIL_SURFACE, 'group/rail relative')}>
        <div
          ref={scrollerRef}
          onScroll={measureEdges}
          className={cn(
            RAIL_ROW,
            'overflow-x-auto scroll-smooth [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden',
          )}
        >
          {canPost && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className={cn(
                CELL,
                'group flex shrink-0 flex-col items-center gap-1.5 rounded-xl text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              )}
            >
              {/* Создание — своим лицом с акцентным плюсом в углу, как в мессенджерах: сразу
                  понятно, что сторис будет от тебя. Без фото — плюс на мягкой подложке, а не
                  серый пунктир, который сливался с пустым местом. */}
              <span className="relative flex size-16 items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-95 motion-reduce:transition-none">
                {me?.avatarUrl ? (
                  <>
                    <Avatar className="size-full ring-1 ring-foreground/10">
                      <AvatarImage src={me.avatarUrl} alt="" />
                      <AvatarFallback>
                        {me.firstName.charAt(0)}
                        {me.lastName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                      <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
                    </span>
                  </>
                ) : (
                  <span className="flex size-full items-center justify-center rounded-full border-2 border-dashed border-primary/40 bg-primary/10 text-primary transition-colors duration-150 group-hover:border-primary group-hover:bg-primary/15">
                    <Plus className="size-6" aria-hidden />
                  </span>
                )}
              </span>
              <span className="w-full truncate text-xs text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
                {t('newStory')}
              </span>
            </button>
          )}

          {rings.map((ring, index) => (
            <RingButton
              key={ring.author.id}
              ring={ring}
              isMe={ring.author.id === myId}
              fresh={freshRings.has(ring.author.id)}
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
                // По центру кольца: поле полосы (0.25rem) + половина кольца (2rem).
                'absolute top-9 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-sm transition-[opacity,background-color] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none sm:flex',
                'opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100',
                side === 'left' ? 'left-2' : 'right-2',
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
        <CreateStoryForm
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
        />
      )}
    </>
  )
}

function RingButton({
  ring,
  isMe,
  fresh = false,
  onOpen,
}: {
  ring: StoryRing
  isMe: boolean
  /** Кольцо только что появилось по сокету — въезжает с подсветкой. */
  fresh?: boolean
  onOpen: () => void
}) {
  const t = useTranslations('Stories')
  const name = isMe ? t('yourStory') : ring.author.firstName
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('openStoryOf', { name: `${ring.author.firstName} ${ring.author.lastName}` })}
      className={cn(
        CELL,
        'group flex shrink-0 flex-col items-center gap-1.5 rounded-xl text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        fresh && 'sh-live-in',
      )}
    >
      {/* Кольцо: яркое у непросмотренных, приглушённое у просмотренных — единственный
          признак, по которому в этом формате отличают новое от уже увиденного. */}
      <span
        data-story-origin={ring.author.id}
        className={cn(
          RING,
          'flex items-center justify-center rounded-full p-[3px] transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-95 motion-reduce:transition-none',
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
