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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
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
      {/* `shrink-0` и НЕ `flex-1 min-h-0`: высота ряда обязана считаться по содержимому,
          то есть по всей ленте. С `flex-1` ряд получал высоту одного экрана (он же
          флекс-элемент колонки, ограниченной высотой `main`), а посты просто вылезали
          за его границы. Для боковой колонки это смертельно: `sticky` не выходит за
          пределы СВОЕГО контейнера, поэтому после одного экрана прокрутки ряд уезжал
          вверх и уносил колонку с собой — она обрезалась сверху и больше не
          возвращалась. */}
      <div
        className={cn(
          'mx-auto flex w-full max-w-xl shrink-0 justify-center gap-6',
          hasFriendsPanel && 'xl:max-w-[57.5rem]',
        )}
      >
        {/* `flex-1` здесь про ШИРИНУ (ряд горизонтальный), высоту колонка берёт по ленте. */}
        <div className="flex w-full max-w-xl min-w-0 flex-1 flex-col">
          <FeedList filter={filter} />
        </div>

        {hasFriendsPanel && (
          // `sticky`: колонка коротка, а лента бесконечна — иначе она уезжает вверх
          // и две трети прокрутки идут вдоль пустого места.
          //
          // Потолок высоты и своя прокрутка — вторая половина той же задачи: колонка
          // выше экрана (шесть друзей плюс три заявки с кнопками) прилипала верхом, и
          // её низ становился недостижим. Теперь она листается внутри себя до конца, а
          // когда содержимого мало — полосы прокрутки нет вовсе. 2rem — отступ сверху
          // (`top-4`) и такой же зазор снизу; `main` занимает всю высоту окна, других
          // полос над ним нет.
          <aside className="hidden w-80 shrink-0 flex-col gap-4 self-start xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto">
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
