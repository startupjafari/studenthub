'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { UserPlus, Users } from 'lucide-react'
import {
  fetchFriendRequests,
  fetchFriends,
  friendKeys,
  type FriendUser,
} from '../../../entities/friendship'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '../../../shared/ui'
import { useFriendsSummary } from '../model/use-friends-summary'
import { useFriendshipMutations } from '../model/use-friendship-mutations'
import { FriendsModal, type FriendsTab } from './friends-modal'

// Сколько показываем в колонке до кнопки «показать всех».
// Заявок — 3: их разбирают сразу, длинный список в боковой колонке никто не листает.
// Друзей — 6: ровно две строки сетки 3×2, как в ВК.
const REQUESTS_PREVIEW = 3
const FRIENDS_PREVIEW = 6

function fullName(u: FriendUser): string {
  return `${u.lastName} ${u.firstName}`
}

function initials(u: FriendUser): string {
  return ((u.lastName[0] ?? '') + (u.firstName[0] ?? '')).toUpperCase()
}

// Квадратный аватар со ссылкой в профиль. `size` задаёт сторону в px для next/image:
// картинки аватаров приходят из MinIO, оптимизатор для них отключён (unoptimized).
function FriendAvatar({
  user,
  size,
  className,
}: {
  user: FriendUser
  size: number
  className: string
}) {
  const src = user.avatarThumbUrl ?? user.avatarUrl
  return src ? (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      className={`${className} object-cover`}
    />
  ) : (
    <span
      className={`${className} flex items-center justify-center bg-primary/10 font-semibold text-primary`}
    >
      {initials(user) || '#'}
    </span>
  )
}

/**
 * Друзья и входящие заявки рядом с лентой (блок из правой колонки, стиль ВК).
 *
 * Блока нет вовсе, пока нет ни друзей, ни заявок: пустая карточка «пока никого»
 * в боковой колонке занимает место и ничего не сообщает — в отличие от расписания,
 * где «сегодня пар нет» само по себе ответ.
 *
 * Списки грузим только тогда, когда счётчик сказал, что там что-то есть: у большинства
 * ролей входящих заявок нет, и два пустых запроса на каждой странице ленты — плата ни за что.
 */
export function FriendsPanel() {
  const t = useTranslations('Friends')
  const [modal, setModal] = useState<FriendsTab | null>(null)
  // Заявку принимают/отклоняют прямо здесь: ради двух кнопок открывать окно — лишний шаг.
  const { accept, remove } = useFriendshipMutations()

  const { hasAny, friends: friendsCount, incoming: incomingCount } = useFriendsSummary()

  const requestsQ = useQuery({
    queryKey: friendKeys.requests('incoming', REQUESTS_PREVIEW),
    queryFn: () => fetchFriendRequests('incoming', REQUESTS_PREVIEW),
    enabled: incomingCount > 0,
  })
  const friendsQ = useQuery({
    queryKey: friendKeys.list(FRIENDS_PREVIEW),
    queryFn: () => fetchFriends(FRIENDS_PREVIEW),
    enabled: friendsCount > 0,
  })

  // Пока счётчики не пришли — ничего не рисуем: скелетон, который в половине случаев
  // сменится пустотой, дёргает раскладку колонки сильнее, чем появление блока.
  if (!hasAny) return null

  const requests = requestsQ.data ?? []
  const friends = friendsQ.data ?? []

  return (
    <>
      {incomingCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" aria-hidden />
              {t('requestsTitle')}
            </CardTitle>
            <CardAction>
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {incomingCount}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            {/* Счётчик уже пришёл, а список ещё нет: показываем ровно столько заготовок,
                сколько карточек появится — карточка не «прыгает» по высоте при загрузке. */}
            {requestsQ.isPending && (
              <div className="flex flex-col gap-3">
                {Array.from({ length: Math.min(incomingCount, REQUESTS_PREVIEW) }).map((_, i) => (
                  <Skeleton key={i} className="h-[4.75rem] w-full rounded-xl" />
                ))}
              </div>
            )}
            <ul className="flex flex-col gap-3">
              {requests.slice(0, REQUESTS_PREVIEW).map((r) => (
                <li key={r.friendshipId} className="flex flex-col gap-2">
                  <Link
                    href={`/profile/${r.user.id}`}
                    className="flex min-w-0 items-center gap-2.5 hover:underline"
                  >
                    <FriendAvatar
                      user={r.user}
                      size={40}
                      className="size-10 shrink-0 rounded-full text-xs"
                    />
                    <span className="min-w-0 truncate text-sm font-medium">{fullName(r.user)}</span>
                  </Link>
                  {/* Кнопки отдельной строкой: в колонке 20rem «аватар + имя + два действия»
                      в одну строку ужимает имя до пары букв. */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => accept.mutate(r.friendshipId)}
                      loading={accept.isPending && accept.variables === r.friendshipId}
                    >
                      {t('accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => remove.mutate({ friendshipId: r.friendshipId })}
                      loading={
                        remove.isPending && remove.variables?.friendshipId === r.friendshipId
                      }
                    >
                      {t('decline')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {incomingCount > REQUESTS_PREVIEW && (
              <Button
                variant="link"
                size="sm"
                className="mt-2 h-auto px-0"
                onClick={() => setModal('incoming')}
              >
                {t('showAll')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {friendsCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden />
              {t('title')}
            </CardTitle>
            <CardAction>
              <span className="text-sm text-muted-foreground tabular-nums">{friendsCount}</span>
            </CardAction>
          </CardHeader>
          <CardContent>
            {/* Сетка 3×2 квадратами — как блок друзей во ВК: за один взгляд видно лица,
                а не строчки текста. Имя — только личное: фамилия в ячейку не влезает. */}
            <ul className="grid grid-cols-3 gap-2">
              {friendsQ.isPending &&
                Array.from({ length: Math.min(friendsCount, FRIENDS_PREVIEW) }).map((_, i) => (
                  <li key={i}>
                    <Skeleton className="aspect-square w-full rounded-xl" />
                  </li>
                ))}
              {friends.slice(0, FRIENDS_PREVIEW).map((f) => (
                <li key={f.friendshipId} className="min-w-0">
                  <Link
                    href={`/profile/${f.user.id}`}
                    title={fullName(f.user)}
                    className="flex flex-col gap-1"
                  >
                    <FriendAvatar
                      user={f.user}
                      size={96}
                      className="aspect-square w-full rounded-xl text-base"
                    />
                    <span className="truncate text-center text-xs hover:underline">
                      {f.user.firstName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {friendsCount > FRIENDS_PREVIEW && (
              <Button
                variant="link"
                size="sm"
                className="mt-2 h-auto px-0"
                onClick={() => setModal('friends')}
              >
                {t('showAll')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {modal && <FriendsModal initialTab={modal} onClose={() => setModal(null)} />}
    </>
  )
}
