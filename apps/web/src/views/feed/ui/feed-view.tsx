'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import type { FeedFilterValue } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { CreatePostForm } from '../../../features/create-post'
import { FeedList } from '../../../widgets/feed-list'
import { FriendsPanel, useFriendsSummary } from '../../../widgets/friends-panel'
import { Button, Modal, PageHeader, SegmentedTabs } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Разделы ленты: фильтр уходит на сервер и всегда пересекается с видимостью зрителя.
const FILTERS: readonly FeedFilterValue[] = ['ALL', 'GROUP', 'UNIVERSITY', 'TEACHERS', 'IMPORTANT']
const FILTER_LABEL: Record<FeedFilterValue, string> = {
  ALL: 'filterAll',
  GROUP: 'filterGroup',
  UNIVERSITY: 'filterUniversity',
  TEACHERS: 'filterTeachers',
  IMPORTANT: 'filterImportant',
}
// Модераторы посты не пишут — только читают и модерируют.
const READONLY_ROLES: Role[] = [Role.PLATFORM_MODERATOR, Role.UNIVERSITY_MODERATOR]

/**
 * Экран ленты для ролей вне студенческой главной.
 *
 * Форма публикации раньше стояла раскрытой над лентой и занимала первый экран целиком
 * — при том что читают ленту несравнимо чаще, чем пишут. Теперь она за кнопкой в шапке,
 * туда же переехали разделы, а сама лента — узкая колонка по центру: строка текста во
 * всю ширину монитора нечитаема, поэтому ленты и делают колонкой.
 */
export function FeedView() {
  const t = useTranslations('Nav')
  const tFeed = useTranslations('Feed')
  const [filter, setFilter] = useState<FeedFilterValue>('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const role = useAppSelector((s) => s.auth.role)
  const canPost = role !== null && !READONLY_ROLES.includes(role)
  // Боковая колонка есть только при непустом блоке друзей — иначе ленту незачем сдвигать.
  const { hasAny: hasFriendsPanel } = useFriendsSummary()

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('posts')}
        tabs={
          <SegmentedTabs
            aria-label={t('posts')}
            value={filter}
            onChange={setFilter}
            items={FILTERS.map((f) => ({ value: f, label: tFeed(FILTER_LABEL[f]) }))}
          />
        }
        actions={
          canPost ? (
            <Button type="button" size="md" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {tFeed('publish')}
            </Button>
          ) : null
        }
      />

      {/* Колонка ленты — 36rem: на 42rem строка получалась длиннее удобной для чтения,
          а квадратные плитки коллажа раздувались вместе с ней. Ширина ленты не зависит
          от боковой колонки — иначе на широком мониторе посты выглядели бы иначе, чем
          на ноутбуке; поэтому у самой ленты фиксированный максимум, а не `flex-1`.

          От xl справа встаёт колонка 20rem, и центрируется уже связка «лента + колонка»
          (36 + 1.5 + 20 = 57.5rem) — как во ВК: колонка не приклеена к краю экрана.
          Ниже xl места на неё нет, а без друзей и заявок её нет вовсе — в обоих случаях
          `justify-center` возвращает ленту ровно в центр страницы. */}
      <div
        className={cn(
          'mx-auto flex w-full max-w-xl justify-center gap-6',
          hasFriendsPanel && 'xl:max-w-[57.5rem]',
        )}
      >
        <div className="w-full max-w-xl min-w-0">
          <FeedList filter={filter} />
        </div>

        {hasFriendsPanel && (
          // `sticky`: колонка коротка, а лента бесконечна — иначе она уезжает вверх
          // и две трети прокрутки идут вдоль пустого места.
          <aside className="hidden w-80 shrink-0 flex-col gap-4 self-start xl:sticky xl:top-4 xl:flex">
            <FriendsPanel />
          </aside>
        )}
      </div>

      {createOpen && (
        <Modal
          onClose={() => setCreateOpen(false)}
          title={tFeed('newPost')}
          size="2xl"
          // На телефоне окно во весь экран: форма длинная, а плавающая карточка
          // с полями по краям отдавала под содержимое меньше половины высоты.
          className="max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:rounded-none"
        >
          <CreatePostForm bare onCreated={() => setCreateOpen(false)} />
        </Modal>
      )}
    </div>
  )
}
