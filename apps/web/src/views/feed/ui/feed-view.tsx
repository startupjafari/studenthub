'use client'

import { Suspense, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import type { FeedFilterValue } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { PostComposerModal } from '../../../features/create-post'
import { FeedList } from '../../../widgets/feed-list'
import { StoriesRail } from '../../../widgets/stories-rail'
import { FriendsPanel, useFriendsSummary } from '../../../widgets/friends-panel'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { fetchFeed } from '../../../entities/post'
import { Button, PageHeader, SegmentedTabs } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ImportantPostsCard, UpcomingEventsCard } from './feed-aside'
import { QuickComposer } from './quick-composer'

// Разделы ленты: фильтр уходит на сервер и всегда пересекается с видимостью зрителя.
// «Сохранённое» — последним: это не срез ленты, а личная полка, и открывают её реже,
// чем читают саму ленту.
const FILTERS: readonly FeedFilterValue[] = [
  'ALL',
  'GROUP',
  'UNIVERSITY',
  'TEACHERS',
  'IMPORTANT',
  'SAVED',
]
const FILTER_LABEL: Record<FeedFilterValue, string> = {
  ALL: 'filterAll',
  GROUP: 'filterGroup',
  UNIVERSITY: 'filterUniversity',
  TEACHERS: 'filterTeachers',
  IMPORTANT: 'filterImportant',
  SAVED: 'filterSaved',
  MODERATION: 'filterModeration',
}
// Модераторы посты не пишут — только читают и модерируют.
const READONLY_ROLES: Role[] = [Role.PLATFORM_MODERATOR, Role.UNIVERSITY_MODERATOR]
// Раздел «Модерация» — не срез личной ленты, а всё, что роль вправе снимать: платформа —
// все вузы, вуз — свой вуз, декан — свой факультет (сервер, filter=MODERATION). Личная
// лента для этого не годилась: модератор платформы видел в ней лишь посты для всех, а
// админ вуза — ни одного поста групп.
const MODERATOR_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

/** Параметр раздела в адресе: `?tab=group`. Без него — раздел по умолчанию для роли. */
const TAB_PARAM = 'tab'
const EVENTS_PREVIEW = 4
const IMPORTANT_PREVIEW = 3

/**
 * Экран «Посты» для ролей вне студенческой главной: лента колонкой по центру, справа —
 * друзья, ближайшие события и важные объявления.
 *
 * `useSearchParams` (раздел в адресе) требует границы Suspense.
 */
export function FeedView() {
  return (
    <Suspense fallback={null}>
      <FeedScreen />
    </Suspense>
  )
}

function FeedScreen() {
  const t = useTranslations('Nav')
  const tFeed = useTranslations('Feed')
  const params = useSearchParams()
  const [compose, setCompose] = useState<{ files?: readonly File[] } | null>(null)
  const listTopRef = useRef<HTMLDivElement>(null)
  const role = useAppSelector((s) => s.auth.role)
  const canPost = role !== null && !READONLY_ROLES.includes(role)
  const canModerate = role !== null && MODERATOR_ROLES.includes(role)
  // Модератору без права публиковать модерация — основная работа: раздел первым и открыт
  // сразу. Админу и декану лента остаётся своей, а «Модерация» — последним разделом.
  // Роль приходит после восстановления сессии — список считается от неё на каждом рендере.
  const filters: readonly FeedFilterValue[] = !canModerate
    ? FILTERS
    : canPost
      ? [...FILTERS, 'MODERATION']
      : ['MODERATION', ...FILTERS]
  // Раздел живёт в адресе: со страницы поста «назад» возвращает в тот же раздел, ссылкой
  // на раздел можно поделиться. Чужой раздел из адреса (модерация без прав) не берётся.
  const fromUrl = params.get(TAB_PARAM)?.toUpperCase() as FeedFilterValue | undefined
  const fallback: FeedFilterValue = canModerate && !canPost ? 'MODERATION' : 'ALL'
  const filter = fromUrl && filters.includes(fromUrl) ? fromUrl : fallback

  function pickFilter(next: FeedFilterValue): void {
    const query = new URLSearchParams(window.location.search)
    if (next === fallback) query.delete(TAB_PARAM)
    else query.set(TAB_PARAM, next.toLowerCase())
    const qs = query.toString()
    // Нативный replaceState: Next синхронизирует его с useSearchParams без запроса к серверу.
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
    // Ушли вниз по ленте — новый раздел начинается с начала, а не с середины прошлого.
    const top = listTopRef.current
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' })
  }

  // Правая колонка — только из настоящих данных: блок без данных не рисуется, а без
  // единого блока колонки нет вовсе и лента встаёт ровно по центру.
  const { hasAny: hasFriends } = useFriendsSummary()
  const events = useQuery({
    queryKey: eventKeys.list('upcoming', false, EVENTS_PREVIEW),
    queryFn: () => fetchEvents({ limit: EVENTS_PREVIEW }),
    retry: false,
  })
  const important = useQuery({
    queryKey: ['feed-aside', 'important', IMPORTANT_PREVIEW],
    queryFn: () => fetchFeed({ limit: IMPORTANT_PREVIEW, filter: 'IMPORTANT' }),
    retry: false,
    staleTime: 60_000,
  })
  const upcoming = (events.data ?? []).slice(0, EVENTS_PREVIEW)
  const pinned = important.data?.items ?? []
  const hasAside = hasFriends || upcoming.length > 0 || pinned.length > 0

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('posts')}
        actions={
          canPost ? (
            <Button type="button" size="md" onClick={() => setCompose({})}>
              <Plus className="size-4" aria-hidden />
              {tFeed('publish')}
            </Button>
          ) : null
        }
      />

      {/* Ряд «лента + колонка». Лента — до 44rem (704px): уже — снимки выходят мелкими, шире —
          строка текста неудобна. Колонка (18rem, с 2xl — 20rem) встаёт сбоку только с 85rem
          (1360px): рядом с сайдбаром приложения на 1280px лента сжималась до 39rem — уже
          40rem. Центрируется связка «лента + колонка», а без колонки — сама лента.

          `shrink-0`, а не `flex-1 min-h-0`: высота ряда считается по всей ленте — иначе
          `sticky` колонки и полосы разделов уезжал бы вместе с рядом после первого экрана.
          Пустая лента (или ошибка) добирает высоту (`grow`), и EmptyState тянется до низа. */}
      <div
        className={cn(
          'mx-auto flex w-full max-w-[44rem] shrink-0 justify-center gap-6 has-[[data-empty-state]]:grow',
          hasAside && 'min-[85rem]:max-w-[63.5rem] 2xl:max-w-[65.5rem]',
        )}
      >
        <div className="flex w-full max-w-[44rem] min-w-0 flex-1 flex-col gap-3 sm:gap-4">
          {/* Разделы — липкой полосой над лентой: переключаются с любого места прокрутки.
              Фон полупрозрачный с размытием — посты под полосой не просвечивают текстом.
              На телефоне ряд листается пальцем, а не сворачивается в список.
              Отрицательный `top` — поле `main`: липкость отсчитывается от него, и без поправки
              полоса вставала на 16–24px ниже края, а над ней просвечивали посты. */}
          <div className="sticky -top-4 z-20 -mx-4 -mt-4 bg-background/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:mx-0 sm:px-0 md:-top-6">
            <SegmentedTabs
              aria-label={t('posts')}
              value={filter}
              onChange={pickFilter}
              collapsible={false}
              compact
              items={filters.map((f) => ({ value: f, label: tFeed(FILTER_LABEL[f]) }))}
            />
          </div>

          {/* Кольца сторис и панель создания — только в общей ленте: в срезах («Важное»,
              «Сохранённое», модерация) они не про тот контент, который человек там ищет. */}
          {filter === 'ALL' && <StoriesRail />}
          {filter === 'ALL' && canPost && (
            <QuickComposer onCompose={(files) => setCompose({ files })} />
          )}

          <div ref={listTopRef} className="scroll-mt-16">
            {/* Раздел сменился — лента въезжает мягко, а не подменяется рывком. */}
            <div
              key={filter}
              className="animate-in fade-in-0 duration-(--motion-page) motion-reduce:animate-none"
            >
              <FeedList filter={filter} />
            </div>
          </div>
        </div>

        {hasAside && (
          // `sticky`: колонка коротка, а лента бесконечна. Потолок высоты и своя прокрутка —
          // колонке выше экрана (друзья, заявки, события): её низ остаётся достижимым.
          <aside className="sh-scroll hidden w-72 shrink-0 flex-col gap-4 self-start min-[85rem]:sticky min-[85rem]:top-0 min-[85rem]:flex min-[85rem]:max-h-[calc(100dvh-2rem)] min-[85rem]:overflow-y-auto 2xl:w-80">
            <FriendsPanel />
            {upcoming.length > 0 && <UpcomingEventsCard events={upcoming} />}
            {pinned.length > 0 && <ImportantPostsCard posts={pinned} />}
          </aside>
        )}
      </div>

      {compose && (
        <PostComposerModal initialFiles={compose.files} onClose={() => setCompose(null)} />
      )}
    </div>
  )
}
