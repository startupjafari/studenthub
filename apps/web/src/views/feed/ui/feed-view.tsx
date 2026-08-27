'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import type { FeedFilterValue } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { CreatePostForm } from '../../../features/create-post'
import { FeedList } from '../../../widgets/feed-list'
import { Button, Modal, PageHeader, SegmentedTabs } from '../../../shared/ui'

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

      <div className="mx-auto w-full max-w-2xl">
        <FeedList filter={filter} />
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
