'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Check, UserPlus, Users, X } from 'lucide-react'
import {
  fetchFriendRequests,
  fetchFriends,
  friendKeys,
  type FriendUser,
} from '../../../entities/friendship'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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

/**
 * Аватар друга. Avatar из системы, а не голый `<Image>`: он показывает заглушку с
 * инициалами и когда ссылки нет, и когда картинка НЕ ЗАГРУЗИЛАСЬ — протухшая
 * presigned-ссылка или недоступный MinIO. У `<Image>` второй случай давал иконку
 * «битая картинка»: в сетке лиц это выглядело поломкой приложения, а не отсутствием
 * фотографии, и вдобавок ломало квадрат ячейки.
 *
 * `className` задаёт форму и размер (круг в списке заявок, квадрат в сетке), поэтому
 * заглушка скругляется по родителю (`rounded-[inherit]`), а не своим `rounded-full`.
 */
function FriendAvatar({
  user,
  className,
  textClassName,
}: {
  user: FriendUser
  className: string
  /** Кегль инициалов: у заглушки свой `text-sm`, наследованием его не перебить. */
  textClassName: string
}) {
  return (
    <Avatar className={className}>
      <AvatarImage src={user.avatarThumbUrl ?? user.avatarUrl ?? undefined} alt="" />
      <AvatarFallback className={`rounded-[inherit] font-semibold ${textClassName}`}>
        {initials(user) || '#'}
      </AvatarFallback>
    </Avatar>
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
        <Card size="sm">
          {/* Счётчик — в строке заголовка, а переход к полному списку — в слоте действий
              справа. Раньше «показать всех» стояла под списком: до неё нужно было
              проскроллить карточку целиком, то есть управление оказывалось дальше, чем
              то, чем оно управляет. Заголовок при этом обрезается (`truncate`), а не
              выталкивает кнопку: в колонке 20rem длинный перевод её бы уронил. */}
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <UserPlus className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{t('requestsTitle')}</span>
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {incomingCount}
              </span>
            </CardTitle>
            {incomingCount > REQUESTS_PREVIEW && (
              <CardAction>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => setModal('incoming')}
                >
                  {t('showAll')}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {/* Счётчик уже пришёл, а список ещё нет: показываем ровно столько заготовок,
                сколько карточек появится — карточка не «прыгает» по высоте при загрузке. */}
            {requestsQ.isPending && (
              <div className="flex flex-col gap-2">
                {Array.from({ length: Math.min(incomingCount, REQUESTS_PREVIEW) }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            )}
            {/* Заявка — одной строкой: аватар, имя и два круглых действия. Прежние кнопки
                во всю ширину под каждым именем делали из трёх заявок полэкрана. Имя
                забирает всё оставшееся место и сокращается, полное — в подсказке. */}
            <ul className="flex flex-col gap-1">
              {requests.slice(0, REQUESTS_PREVIEW).map((r) => {
                const accepting = accept.isPending && accept.variables === r.friendshipId
                const declining =
                  remove.isPending && remove.variables?.friendshipId === r.friendshipId
                return (
                  <li
                    key={r.friendshipId}
                    className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-muted/60"
                  >
                    <Link
                      href={`/profile/${r.user.id}`}
                      title={fullName(r.user)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      <FriendAvatar
                        user={r.user}
                        className="size-9 shrink-0 rounded-full"
                        textClassName="text-xs"
                      />
                      <span className="min-w-0 truncate text-sm font-medium hover:underline">
                        {fullName(r.user)}
                      </span>
                    </Link>
                    <Button
                      size="sm"
                      icon
                      className="size-8 shrink-0 rounded-full"
                      aria-label={`${t('accept')}: ${fullName(r.user)}`}
                      title={t('accept')}
                      disabled={declining}
                      loading={accepting}
                      onClick={() => accept.mutate(r.friendshipId)}
                    >
                      <Check className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      icon
                      variant="outline"
                      className="size-8 shrink-0 rounded-full"
                      aria-label={`${t('decline')}: ${fullName(r.user)}`}
                      title={t('decline')}
                      disabled={accepting}
                      loading={declining}
                      onClick={() => remove.mutate({ friendshipId: r.friendshipId })}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {friendsCount > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <Users className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{t('title')}</span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {friendsCount}
              </span>
            </CardTitle>
            {friendsCount > FRIENDS_PREVIEW && (
              <CardAction>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => setModal('friends')}
                >
                  {t('showAll')}
                </Button>
              </CardAction>
            )}
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
                    className="group flex flex-col gap-1 rounded-xl focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <FriendAvatar
                      user={f.user}
                      // `size-auto` первым: у Avatar в базе `size-9`, и он задаёт
                      // ВЫСОТУ — одним `w-full` его не перебить, ячейка осталась бы
                      // полосой 36px. Дальше высоту даёт aspect-square.
                      className="size-auto aspect-square w-full rounded-xl object-cover ring-1 ring-foreground/5 transition-opacity duration-150 group-hover:opacity-90"
                      textClassName="text-base"
                    />
                    <span className="truncate text-center text-xs group-hover:underline">
                      {f.user.firstName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {modal && <FriendsModal initialTab={modal} onClose={() => setModal(null)} />}
    </>
  )
}
