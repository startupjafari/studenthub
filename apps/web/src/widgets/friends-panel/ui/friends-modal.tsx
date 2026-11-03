'use client'

import { useDeferredValue, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Check,
  Clock,
  Inbox,
  MessageCircle,
  MoreHorizontal,
  Search,
  Send,
  UserRound,
  UserRoundMinus,
  Users,
  X,
} from 'lucide-react'
import {
  FriendCard,
  fetchFriendRequestsPage,
  fetchFriendsPage,
  friendKeys,
  type FriendUser,
} from '../../../entities/friendship'
import { CHATS_HREF_BY_ROLE } from '../../../shared/config'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Modal,
  SegmentedTabs,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { useFriendsSummary } from '../model/use-friends-summary'
import { useFriendshipMutations } from '../model/use-friendship-mutations'

type Tab = 'friends' | 'incoming' | 'outgoing'
const TABS: readonly Tab[] = ['friends', 'incoming', 'outgoing']
const TAB_LABEL: Record<Tab, string> = {
  friends: 'tabFriends',
  incoming: 'tabIncoming',
  outgoing: 'tabOutgoing',
}
const EMPTY: Record<Tab, { title: string; hint: string; icon: typeof Users }> = {
  friends: { title: 'emptyFriends', hint: 'emptyFriendsHint', icon: Users },
  incoming: { title: 'emptyIncoming', hint: 'emptyIncomingHint', icon: Inbox },
  outgoing: { title: 'emptyOutgoing', hint: 'emptyOutgoingHint', icon: Send },
}
// Поиск появляется, когда друзей больше, чем видно без прокрутки: в списке из трёх
// человек поле поиска только отнимает место.
const SEARCH_FROM = 7

function fullName(u: FriendUser): string {
  return [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ')
}

// «ё» и «е» в именах пишут вперемешку — ищем без разницы, как и без регистра.
function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/ё/g, 'е').trim()
}

function matches(u: FriendUser, query: string): boolean {
  const q = normalize(query)
  return normalize(fullName(u)).includes(q) || normalize(`${u.firstName} ${u.lastName}`).includes(q)
}

/**
 * Полные списки друзей и заявок.
 *
 * Окно, а не страница: отдельного раздела «Друзья» в навигации нет намеренно
 * (widgets/app-shell/model/nav.ts) — связями управляют из профилей и уведомлений.
 * Окно поверх ленты сохраняет это правило и не уводит со страницы, на которой
 * пользователь читал посты.
 *
 * Высота — по содержимому (до 85dvh), а не постоянная: пустая вкладка в окне постоянной
 * высоты была большой рамкой с одной фразой посередине. Чтобы окно при этом не скакало
 * при переключении вкладок, на десктопе оно прикреплено верхом (растёт только вниз —
 * переключатель остаётся под курсором), а на телефоне — низом, как лист.
 */
export function FriendsModal({ initialTab, onClose }: { initialTab: Tab; onClose: () => void }) {
  const t = useTranslations('Friends')
  const tErr = useTranslations('Errors')
  const router = useRouter()
  const role = useAppSelector((s) => s.auth.role)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search)
  const { accept, remove } = useFriendshipMutations()
  const { friends: friendsCount, incoming: incomingCount } = useFriendsSummary()
  const confirm = useConfirm()

  // Удаление из друзей необратимо (вернуть — только новой заявкой) — с подтверждением;
  // отмена своей заявки и отклонение чужой — сразу.
  async function removeFriend(friendshipId: string): Promise<void> {
    const ok = await confirm({
      title: t('removeConfirm'),
      description: t('removeConfirmHint'),
      confirmLabel: t('remove'),
      destructive: true,
    })
    if (ok) remove.mutate({ friendshipId, message: t('removed') })
  }

  // «Написать»: личный чат находится или заводится, и он открывается на странице чатов
  // своей роли — тот же путь, что у кнопки в профиле. Модуль чатов подгружается только
  // по нажатию: окну друзей он больше ни для чего не нужен.
  const chatsHref = role ? CHATS_HREF_BY_ROLE[role] : undefined
  const openChat = useMutation({
    mutationFn: async (userId: string) => {
      const { createChatRequest } = await import('../../../entities/chat')
      return createChatRequest({ type: 'PRIVATE', memberIds: [userId] })
    },
    onSuccess: (chat) => {
      onClose()
      router.push(`${chatsHref}?chat=${chat.id}`)
    },
    // Личный чат заводится только внутри своего вуза — молчаливая неудача выглядела бы
    // как сломанная кнопка.
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Полные списки — страницами с курсором: одним запросом приходила только первая
  // страница сервера (20), и друзья и заявки сверх неё в окне не показывались вовсе.
  const direction = tab === 'outgoing' ? 'outgoing' : 'incoming'
  const friendsQ = useInfiniteQuery({
    queryKey: friendKeys.listPages(),
    queryFn: ({ pageParam }) => fetchFriendsPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
    enabled: tab === 'friends',
  })
  const requestsQ = useInfiniteQuery({
    queryKey: friendKeys.requestPages(direction),
    queryFn: ({ pageParam }) => fetchFriendRequestsPage(direction, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
    enabled: tab !== 'friends',
  })

  const active = tab === 'friends' ? friendsQ : requestsQ
  const loading = active.isPending
  const allRows =
    tab === 'friends'
      ? (friendsQ.data?.pages ?? []).flatMap((page) =>
          page.items.map((f) => ({ id: f.friendshipId, user: f.user })),
        )
      : (requestsQ.data?.pages ?? []).flatMap((page) =>
          page.items.map((r) => ({ id: r.friendshipId, user: r.user })),
        )

  // Поиск — по уже загруженному списку, отдельного API под него нет: друзей у человека
  // сотни, а не миллионы. Чтобы искать по всем, а не по первой странице, во время поиска
  // догружаем оставшиеся страницы.
  const showSearch = tab === 'friends' && friendsCount >= SEARCH_FROM
  const searching = showSearch && query.trim().length > 0
  const rows = searching ? allRows.filter((r) => matches(r.user, query)) : allRows
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = friendsQ
  useEffect(() => {
    if (searching && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [searching, hasNextPage, isFetchingNextPage, fetchNextPage])

  function changeTab(next: Tab): void {
    setTab(next)
    setSearch('')
  }

  // Действия у строки зависят от вкладки: у входящей заявки — принять/отклонить, у
  // исходящей — отменить, у друга — «Написать» и меню. Удаление друга спрятано в меню:
  // постоянная кнопка «Удалить» в каждой строке была самым заметным действием окна,
  // хотя нужна реже всех.
  function actionsFor(friendshipId: string, user: FriendUser): ReactNode {
    const name = fullName(user)
    const removing = remove.isPending && remove.variables?.friendshipId === friendshipId
    if (tab === 'incoming') {
      const accepting = accept.isPending && accept.variables === friendshipId
      return (
        <>
          {/* На узком экране — только иконки: две подписи рядом с именем оставляли ему
              пару букв. Название действия остаётся в aria-label и подсказке. */}
          <Button
            size="sm"
            aria-label={`${t('accept')}: ${name}`}
            title={t('accept')}
            disabled={removing}
            loading={accepting}
            onClick={() => accept.mutate(friendshipId)}
          >
            <Check className="size-4 sm:hidden" aria-hidden />
            <span className="max-sm:sr-only">{t('accept')}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${t('decline')}: ${name}`}
            title={t('decline')}
            disabled={accepting}
            loading={removing}
            onClick={() => remove.mutate({ friendshipId })}
          >
            <X className="size-4 sm:hidden" aria-hidden />
            <span className="max-sm:sr-only">{t('decline')}</span>
          </Button>
        </>
      )
    }
    if (tab === 'outgoing') {
      return (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${t('cancelRequest')}: ${name}`}
          loading={removing}
          onClick={() => remove.mutate({ friendshipId })}
        >
          {t('cancel')}
        </Button>
      )
    }
    const opening = openChat.isPending && openChat.variables === user.id
    return (
      <>
        {chatsHref && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('writeTo', { name })}
            title={t('write')}
            disabled={openChat.isPending && !opening}
            loading={opening}
            onClick={() => openChat.mutate(user.id)}
          >
            <MessageCircle className="size-4" aria-hidden />
            <span className="max-sm:sr-only">{t('write')}</span>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label={`${t('moreActions')}: ${name}`}
              title={t('moreActions')}
              loading={removing}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/profile/${user.id}`)}>
              <UserRound aria-hidden />
              {t('openProfile')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void removeFriend(friendshipId)}>
              <UserRoundMinus aria-hidden />
              {t('removeFriend')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }

  const empty = EMPTY[tab]
  const EmptyIcon = empty.icon

  return (
    // Отступы и прокрутку тело окна отдаёт содержимому (`p-0`, `overflow-hidden`):
    // шапка, переключатель и поиск закреплены, прокручивается только список — одна
    // полоса прокрутки, без второй у всего окна.
    <Modal
      onClose={onClose}
      title={t('title')}
      size="lg"
      bodyClassName="overflow-hidden p-0"
      className="max-h-[min(85dvh,44rem)] sm:top-[max(1rem,10dvh)] sm:translate-y-0 max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none"
    >
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 sm:px-5">
        <SegmentedTabs
          aria-label={t('title')}
          value={tab}
          onChange={changeTab}
          stretch
          collapsible={false}
          items={TABS.map((v) => ({
            value: v,
            label: t(TAB_LABEL[v]),
            // Счётчик — только у входящих: это единственная вкладка, где число требует
            // действия. Число друзей уже в заголовке блока в колонке.
            count: v === 'incoming' ? incomingCount : undefined,
          }))}
        />
        {showSearch && (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              size="md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="pl-9"
            />
          </div>
        )}
      </div>

      {/* Поля списка (px-2/sm:px-3) плюс поле строки (px-2) = поле шапки (16/20px): аватары
          стоят на одной вертикали с переключателем. Снизу на телефоне — место под
          «домашнюю» полосу (safe-area). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pt-2 pb-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-3">
        {loading ? (
          // Заготовки — той же высоты, что строки: список приходит на их место без сдвига.
          <ul className="flex flex-col" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex min-h-14 items-center gap-3 px-2 py-1.5">
                <Skeleton className="size-11 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </li>
            ))}
          </ul>
        ) : allRows.length === 0 ? (
          // Пусто — компактно: иконка, заголовок, одна строка пояснения. Без пунктирной
          // рамки: в окне по содержимому она была бы единственным, что его растягивает.
          <EmptyState
            icon={<EmptyIcon className="size-5" aria-hidden />}
            title={t(empty.title)}
            description={t(empty.hint)}
            className="border-0 px-6 py-10"
          />
        ) : rows.length === 0 ? (
          isFetchingNextPage ? (
            <div className="flex min-h-14 items-center gap-3 px-2 py-1.5" aria-hidden>
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-2/5" />
            </div>
          ) : (
            <EmptyState
              icon={<Search className="size-5" aria-hidden />}
              title={t('searchEmpty')}
              description={t('searchEmptyHint')}
              className="border-0 px-6 py-10"
            />
          )
        ) : (
          <>
            <ul className="flex flex-col">
              {rows.map((row) => (
                <li key={row.id}>
                  <FriendCard
                    user={row.user}
                    meta={
                      tab === 'outgoing' ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <span aria-hidden>·</span>
                          <Clock className="size-3" aria-hidden />
                          {t('pending')}
                        </span>
                      ) : undefined
                    }
                    action={actionsFor(row.id, row.user)}
                  />
                </li>
              ))}
            </ul>
            {/* Во время поиска страницы догружаются сами — кнопка нужна только без него. */}
            {active.hasNextPage && !searching && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="mt-2 w-full"
                loading={active.isFetchingNextPage}
                onClick={() => void active.fetchNextPage()}
              >
                {t('showMore')}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

export type { Tab as FriendsTab }
