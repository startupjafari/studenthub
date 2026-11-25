'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, MessageCircle, UserPlus, Users, X } from 'lucide-react'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import {
  fetchFriendRequests,
  fetchFriends,
  friendKeys,
  type FriendUser,
} from '../../../entities/friendship'
import { createChatRequest } from '../../../entities/chat'
import { CHATS_HREF_BY_ROLE } from '../../../shared/config'
import { useAppSelector } from '../../../shared/store'
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
import { cn, toApiError, useFreshIds } from '../../../shared/lib'
import { useLiveRefresh } from '../../../shared/realtime'
import { useFriendsSummary } from '../model/use-friends-summary'
import { useFriendshipMutations } from '../model/use-friendship-mutations'
import { FriendsModal, type FriendsTab } from './friends-modal'

// Сколько показываем в колонке до кнопки «показать всех».
// Заявок — 3: их разбирают сразу, длинный список в боковой колонке никто не листает.
// Друзей — 6 строк: колонка остаётся короче экрана вместе с событиями и важным.
const REQUESTS_PREVIEW = 3
const FRIENDS_PREVIEW = 6
// Стабильный пустой список для useFreshIds: новый массив на каждом рендере сбивал бы его эффект.
const NO_IDS: readonly string[] = []

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
  const tRoles = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const router = useRouter()
  const role = useAppSelector((s) => s.auth.role)
  const chatsHref = role ? CHATS_HREF_BY_ROLE[role] : undefined
  // «Написать» — личный чат с другом: заводится (или находится) сервером и открывается.
  const openChat = useMutation({
    mutationFn: (userId: string) => createChatRequest({ type: 'PRIVATE', memberIds: [userId] }),
    onSuccess: (chat) => {
      if (chatsHref) router.push(`${chatsHref}?chat=${chat.id}`)
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const [modal, setModal] = useState<FriendsTab | null>(null)
  // Заявку принимают/отклоняют прямо здесь: ради двух кнопок открывать окно — лишний шаг.
  const { accept, remove } = useFriendshipMutations()

  const { counts, hasAny, friends: friendsCount, incoming: incomingCount } = useFriendsSummary()

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

  // Живые друзья (§9.2d): заявка пришла, её отозвали, приняли нашу, удалили из друзей —
  // сервер шлёт сигнал второй стороне, и колонка перечитывает счётчики и списки сама.
  // Всё поддерево `friends`: оно же держит кнопку дружбы в профилях из кэша, и окно
  // «Друзья» (оно открывается отсюда). Свои действия сигнала не дают — их обновляет
  // useFriendshipMutations.
  useLiveRefresh(REALTIME_EVENTS.friendsChanged, [friendKeys.all])
  // Новая заявка и новый друг въезжают с подсветкой — их видно, а не угадывать по сдвигу.
  // Счётчик пришёл и он ноль — список заведомо пуст (запрос выключен): это и есть точка
  // отсчёта, иначе первая в жизни заявка стала бы ею и не подсветилась.
  const countsKnown = counts !== undefined
  const requestIds = useMemo(
    () =>
      requestsQ.data?.map((r) => r.friendshipId) ??
      (countsKnown && incomingCount === 0 ? NO_IDS : undefined),
    [requestsQ.data, countsKnown, incomingCount],
  )
  const friendIds = useMemo(
    () =>
      friendsQ.data?.map((f) => f.friendshipId) ??
      (countsKnown && friendsCount === 0 ? NO_IDS : undefined),
    [friendsQ.data, countsKnown, friendsCount],
  )
  const freshRequests = useFreshIds(requestIds)
  const freshFriends = useFreshIds(friendIds)

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
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-muted/60',
                      freshRequests.has(r.friendshipId) && 'sh-live-in',
                    )}
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
          </CardHeader>
          <CardContent>
            {/* Строками: круглый аватар, имя и подпись, справа — «Написать». Сетка крупных
                квадратов занимала полэкрана ради шести лиц. */}
            <ul className="-mx-2 flex flex-col">
              {friendsQ.isPending &&
                Array.from({ length: Math.min(friendsCount, FRIENDS_PREVIEW) }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-2 py-1.5">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <Skeleton className="h-3.5 flex-1" />
                  </li>
                ))}
              {friends.slice(0, FRIENDS_PREVIEW).map((f) => (
                <li
                  key={f.friendshipId}
                  className={cn(
                    'flex items-center gap-1 rounded-lg pr-1',
                    freshFriends.has(f.friendshipId) && 'sh-live-in',
                  )}
                >
                  <Link
                    href={`/profile/${f.user.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <FriendAvatar
                      user={f.user}
                      className="size-10 shrink-0 rounded-full"
                      textClassName="text-xs"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{fullName(f.user)}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {f.user.headline || tRoles(f.user.role)}
                      </span>
                    </span>
                  </Link>
                  {chatsHref && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`${t('write')} · ${fullName(f.user)}`}
                      title={t('write')}
                      disabled={openChat.isPending}
                      onClick={() => openChat.mutate(f.user.id)}
                      className="size-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <MessageCircle className="size-[1.125rem] -scale-x-100" aria-hidden />
                    </Button>
                  )}
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
