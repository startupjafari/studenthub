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
    <Modal onClose={onClose} title={t('title')} size="lg">
      <div className="flex flex-col gap-4">
        <SegmentedTabs
          aria-label={t('title')}
          value={tab}
          onChange={setTab}
          items={TABS.map((v) => ({ value: v, label: t(TAB_LABEL[v]) }))}
        />

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[4.5rem] w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<UserRoundX className="size-6" aria-hidden />}
            title={t(EMPTY_LABEL[tab])}
            className="min-h-[200px]"
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
