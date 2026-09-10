'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { UserRoundX } from 'lucide-react'
import {
  FriendCard,
  fetchFriendRequests,
  fetchFriends,
  friendKeys,
} from '../../../entities/friendship'
import { Button, EmptyState, Modal, SegmentedTabs, Skeleton } from '../../../shared/ui'
import { useFriendshipMutations } from '../model/use-friendship-mutations'

type Tab = 'friends' | 'incoming' | 'outgoing'
const TABS: readonly Tab[] = ['friends', 'incoming', 'outgoing']
const TAB_LABEL: Record<Tab, string> = {
  friends: 'tabFriends',
  incoming: 'tabIncoming',
  outgoing: 'tabOutgoing',
}
const EMPTY_LABEL: Record<Tab, string> = {
  friends: 'emptyFriends',
  incoming: 'emptyIncoming',
  outgoing: 'emptyOutgoing',
}

/**
 * Полные списки друзей и заявок.
 *
 * Окно, а не страница: отдельного раздела «Друзья» в навигации нет намеренно
 * (widgets/app-shell/model/nav.ts) — связями управляют из профилей и уведомлений.
 * Окно поверх ленты сохраняет это правило и не уводит со страницы, на которой
 * пользователь читал посты.
 */
export function FriendsModal({ initialTab, onClose }: { initialTab: Tab; onClose: () => void }) {
  const t = useTranslations('Friends')
  const [tab, setTab] = useState<Tab>(initialTab)
  const { accept, remove } = useFriendshipMutations()

  const friendsQ = useQuery({
    queryKey: friendKeys.list(),
    queryFn: () => fetchFriends(),
    enabled: tab === 'friends',
  })
  const requestsQ = useQuery({
    queryKey: friendKeys.requests(tab === 'outgoing' ? 'outgoing' : 'incoming'),
    queryFn: () => fetchFriendRequests(tab === 'outgoing' ? 'outgoing' : 'incoming'),
    enabled: tab !== 'friends',
  })

  const loading = tab === 'friends' ? friendsQ.isPending : requestsQ.isPending
  const rows =
    tab === 'friends'
      ? (friendsQ.data ?? []).map((f) => ({ id: f.friendshipId, user: f.user }))
      : (requestsQ.data ?? []).map((r) => ({ id: r.friendshipId, user: r.user }))

  // Действия у карточки зависят от вкладки: у входящей заявки — принять/отклонить,
  // у исходящей — только отменить, у друга — удалить.
  function actionsFor(friendshipId: string) {
    if (tab === 'incoming') {
      return (
        <>
          <Button
            size="sm"
            onClick={() => accept.mutate(friendshipId)}
            loading={accept.isPending && accept.variables === friendshipId}
          >
            {t('accept')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => remove.mutate({ friendshipId })}
            loading={remove.isPending && remove.variables?.friendshipId === friendshipId}
          >
            {t('decline')}
          </Button>
        </>
      )
    }
    const label = tab === 'outgoing' ? t('cancel') : t('remove')
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          remove.mutate({ friendshipId, message: tab === 'friends' ? t('removed') : undefined })
        }
        loading={remove.isPending && remove.variables?.friendshipId === friendshipId}
      >
        {label}
      </Button>
    )
  }

  return (
    // `height="stable"`: вкладки переключают содержимое на месте, и без фиксированной
    // высоты окно меняло размер на каждое переключение — список друзей во весь экран,
    // четыре исходящие заявки вдвое ниже. Окно центрировано, поэтому вместе с высотой
    // менялось и его положение: кнопка уезжала из-под курсора.
    //
    // Отступы и прокрутку тело окна отдаёт содержимому (`p-0`, `overflow-hidden`):
    // переключатель вкладок закреплён, а прокручивается только список — при постоянной
    // высоте уезжающий вместе со списком переключатель был бы хуже прежнего скачка.
    <Modal
      onClose={onClose}
      title={t('title')}
      size="lg"
      height="stable"
      bodyClassName="overflow-hidden p-0"
    >
      <div className="shrink-0 px-5 pt-5">
        <SegmentedTabs
          aria-label={t('title')}
          value={tab}
          onChange={setTab}
          items={TABS.map((v) => ({ value: v, label: t(TAB_LABEL[v]) }))}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5">
        {loading ? (
          // Заглушки делят высоту окна: она теперь постоянна, и четыре полосы по 4.5rem
          // оставляли под собой пустоту вместо списка, который придёт на их место.
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="min-h-[4.5rem] w-full flex-1 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          // `EmptyState` сам по себе `min-h-0 flex-1` — в этой колонке он занимает
          // остаток высоты и центрируется, отдельный `min-h` ему не нужен.
          <EmptyState
            icon={<UserRoundX className="size-6" aria-hidden />}
            title={t(EMPTY_LABEL[tab])}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <FriendCard user={row.user} action={actionsFor(row.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

export type { Tab as FriendsTab }
