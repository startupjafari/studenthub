'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Ban,
  Copy,
  Crown,
  Link2,
  MessageSquare,
  MoreVertical,
  Shield,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserRound,
  Users,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  banChatMemberRequest,
  blockUserRequest,
  chatKeys,
  createChatRequest,
  fetchBlockedUsers,
  fetchChatMembers,
  removeChatMemberRequest,
  setChatAdminRequest,
  transferOwnershipRequest,
  unbanChatMemberRequest,
  unblockUserRequest,
  type ChatListItem,
  type ChatMemberInfo,
} from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, useConfirm } from '../../../shared/ui'
import { identityColor, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { useColumnNavigate } from '../lib/column-navigation'
import { MemberActionsMenu, type MemberMenuItem } from './member-actions-menu'
import { RowsSkeleton, TabEmpty, TabError } from './shared-media'

type Translate = (key: string, values?: Record<string, number>) => string

/** «был(а) N назад» из ISO last-seen (§49). */
export function lastSeenText(iso: string, t: Translate): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return t('lastSeenNow')
  if (min < 60) return t('lastSeenMin', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('lastSeenHour', { count: hr })
  return t('lastSeenDay', { count: Math.floor(hr / 24) })
}

/**
 * Порядок участников как в Telegram: я, затем кто в сети, затем по свежести «был(а)»,
 * исключённые — в самом конце. Иначе в группе на сотню человек живые собеседники терялись
 * среди тех, кто заходил месяц назад, в порядке вступления.
 */
function sortMembers(list: ChatMemberInfo[], myId: string | undefined): ChatMemberInfo[] {
  const seen = (m: ChatMemberInfo): number => (m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : 0)
  return [...list].sort((a, b) => {
    if (a.banned !== b.banned) return a.banned ? 1 : -1
    if (a.id === myId || b.id === myId) return a.id === myId ? -1 : 1
    if (a.online !== b.online) return a.online ? -1 : 1
    return seen(b) - seen(a)
  })
}

export type MembersFilter = 'all' | 'admins' | 'banned'

/**
 * Участники группы: аватар со значком «в сети», имя, статус присутствия и роль в вузе, справа —
 * ранг в группе (владелец, админ). Действия над участником — меню по правому клику или по
 * кнопке «⋮», набор пунктов зависит от прав смотрящего.
 */
export function ChatMembersList({
  chat,
  myId,
  onOpenChat,
  filter = 'all',
  query = '',
}: {
  chat: ChatListItem
  myId: string | undefined
  onOpenChat: (chatId: string) => void
  filter?: MembersFilter
  /** Поиск по имени (экран управления участниками). */
  query?: string
}) {
  const t = useTranslations('Chats')
  const tr = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  // В колонке переход закрывает её и ждёт снятия записи истории (column-navigation.tsx).
  const navigate = useColumnNavigate()
  const confirm = useConfirm()
  const [memberMenu, setMemberMenu] = useState<{ m: ChatMemberInfo; x: number; y: number } | null>(
    null,
  )

  const members = useQuery({
    queryKey: chatKeys.members(chat.id),
    queryFn: () => fetchChatMembers(chat.id),
  })
  // Мои персональные блокировки — чтобы показывать «Заблокировать»/«Разблокировать» по факту.
  const blockedQuery = useQuery({ queryKey: chatKeys.blocked(), queryFn: fetchBlockedUsers })
  const blockedIds = new Set((blockedQuery.data ?? []).map((b) => b.id))

  // Владелец — по полю сервера у любого участника (§8.3); старый сервер его не отдаёт, тогда
  // знаем только про себя.
  const isOwnerMember = (m: ChatMemberInfo): boolean =>
    m.isOwner === true || (chat.isOwner && m.id === myId)

  const list = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const filtered = (members.data ?? []).filter((m) => {
      const owner = m.isOwner === true || (chat.isOwner && m.id === myId)
      if (filter === 'admins' && !(m.isAdmin || owner)) return false
      if (filter === 'banned' && !m.banned) return false
      if (!needle) return true
      return `${m.lastName} ${m.firstName}`.toLocaleLowerCase().includes(needle)
    })
    return sortMembers(filtered, myId)
  }, [members.data, filter, query, chat.isOwner, myId])

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidateMembers = () => {
    void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  }

  const ban = useMutation({
    mutationFn: ({ userId, banned }: { userId: string; banned: boolean }) =>
      banned ? unbanChatMemberRequest(chat.id, userId) : banChatMemberRequest(chat.id, userId),
    onSuccess: (_d, { banned }) => {
      invalidateMembers()
      toast.success(banned ? t('memberUnbanned') : t('memberBanned'))
    },
    onError: err,
  })

  const admin = useMutation({
    mutationFn: ({ userId, makeAdmin }: { userId: string; makeAdmin: boolean }) =>
      setChatAdminRequest(chat.id, userId, makeAdmin),
    onSuccess: (_d, { makeAdmin }) => {
      invalidateMembers()
      toast.success(makeAdmin ? t('adminGranted') : t('adminRevoked'))
    },
    onError: err,
  })

  const transfer = useMutation({
    mutationFn: (userId: string) => transferOwnershipRequest(chat.id, userId),
    onSuccess: () => {
      invalidateMembers()
      toast.success(t('ownershipTransferred'))
    },
    onError: err,
  })

  const kick = useMutation({
    mutationFn: (userId: string) => removeChatMemberRequest(chat.id, userId),
    onSuccess: () => {
      invalidateMembers()
      toast.success(t('memberRemoved'))
    },
    onError: err,
  })

  // «Написать»: создать/найти личный чат с участником и переключиться на него.
  const openPrivate = useMutation({
    mutationFn: (userId: string) => createChatRequest({ type: 'PRIVATE', memberIds: [userId] }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      // Про запрос на переписку (§50) не говорим: он уйдёт только с первым сообщением.
      onOpenChat(created.id)
    },
    onError: err,
  })

  // Персональная блокировка/разблокировка пользователя (запрет личной переписки).
  const block = useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      blocked ? unblockUserRequest(userId) : blockUserRequest(userId),
    onSuccess: (_d, { blocked }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.blocked() })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(blocked ? t('userUnblocked') : t('userBlocked'))
    },
    onError: err,
  })

  // Пункты меню действий над участником — по правам смотрящего (владелец/админ) и статусу.
  function memberItems(m: ChatMemberInfo): MemberMenuItem[] {
    const items: MemberMenuItem[] = [
      {
        key: 'profile',
        label: t('openProfile'),
        icon: UserRound,
        onClick: () => navigate(`/profile/${m.id}`),
      },
    ]
    if (m.id !== myId) {
      items.push({
        key: 'write',
        label: t('write'),
        icon: MessageSquare,
        onClick: () => openPrivate.mutate(m.id),
      })
    }
    items.push({
      key: 'copyName',
      label: t('copyName'),
      icon: Copy,
      onClick: () => {
        void navigator.clipboard?.writeText(`${m.lastName} ${m.firstName}`.trim())
        toast.success(t('copied'))
      },
    })
    items.push({
      key: 'copyLink',
      label: t('copyLink'),
      icon: Link2,
      onClick: () => {
        void navigator.clipboard?.writeText(`${window.location.origin}/profile/${m.id}`)
        toast.success(t('linkCopied'))
      },
    })
    if (chat.isOwner && m.id !== myId && !m.banned) {
      items.push({
        key: 'admin',
        label: m.isAdmin ? t('revokeAdmin') : t('grantAdmin'),
        icon: m.isAdmin ? ShieldOff : Shield,
        onClick: () => admin.mutate({ userId: m.id, makeAdmin: !m.isAdmin }),
      })
      items.push({
        key: 'transfer',
        label: t('transferOwnership'),
        icon: Crown,
        onClick: () => {
          void confirm({ title: t('transferConfirm', { name: m.firstName }) }).then((ok) => {
            if (ok) transfer.mutate(m.id)
          })
        },
      })
    }
    // Бан — только создатель группы (§8.3), как и аватар.
    if (chat.isOwner && m.id !== myId) {
      items.push({
        key: 'ban',
        label: m.banned ? t('unban') : t('ban'),
        icon: m.banned ? UserCheck : Ban,
        onClick: () => ban.mutate({ userId: m.id, banned: m.banned }),
        danger: !m.banned,
      })
    }
    if (m.id !== myId) {
      const isBlocked = blockedIds.has(m.id)
      items.push({
        key: 'block',
        label: isBlocked ? t('unblockUser') : t('blockUser'),
        icon: isBlocked ? UserCheck : Ban,
        onClick: () => block.mutate({ userId: m.id, blocked: isBlocked }),
        danger: !isBlocked,
      })
    }
    if ((chat.isOwner || (chat.isAdmin && !m.isAdmin)) && m.id !== myId && !isOwnerMember(m)) {
      items.push({
        key: 'kick',
        label: t('removeFromGroup'),
        icon: UserMinus,
        onClick: () => {
          void confirm({
            title: t('removeConfirm', { name: m.firstName }),
            destructive: true,
          }).then((ok) => {
            if (ok) kick.mutate(m.id)
          })
        },
        danger: true,
      })
    }
    return items
  }

  if (members.isLoading) return <RowsSkeleton rows={8} />
  if (members.isError && !members.data) return <TabError onRetry={() => void members.refetch()} />
  if (list.length === 0) {
    return (
      <TabEmpty
        icon={<Users className="size-6" aria-hidden />}
        title={
          query.trim()
            ? t('tgRight.nothingFound')
            : filter === 'banned'
              ? t('tgRight.bannedEmpty')
              : t('sharedEmpty')
        }
      />
    )
  }

  return (
    <>
      <ul className="py-1">
        {list.map((m) => {
          const name = `${m.lastName} ${m.firstName}`.trim()
          const isOwnerRow = isOwnerMember(m)
          const rank = m.banned
            ? null
            : isOwnerRow
              ? t('tgRight.owner')
              : m.isAdmin
                ? t('adminBadge')
                : null
          // Статус — в цвете акцента, если человек в сети (как в Telegram). Скрытое
          // присутствие (§3.7) приходит без last-seen — тогда «был(а) недавно».
          const status = m.online
            ? t('online')
            : m.lastSeenAt
              ? lastSeenText(m.lastSeenAt, t)
              : t('tgRight.lastSeenRecently')
          // Роль в вузе — подсказка, кто это, но «студент» в студенческой группе — шум.
          const role = m.role !== Role.STUDENT ? tr(m.role) : null
          return (
            <li key={m.id}>
              <div
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMemberMenu({ m, x: e.clientX, y: e.clientY })
                }}
                className={cn(
                  'group flex w-full items-center gap-1 pl-2 pr-1 transition-colors hover:bg-muted/40',
                  m.banned && 'opacity-60',
                )}
              >
                <ProfileLink
                  userId={m.id}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 hover:opacity-100"
                >
                  <span className="relative shrink-0">
                    <Avatar className="size-11">
                      {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={name} />}
                      <AvatarFallback className={cn('text-white', identityColor(m.id))}>
                        {identityInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    {m.online && (
                      <span
                        className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-background bg-success"
                        aria-hidden
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {name}
                        {m.id === myId ? ` (${t('you')})` : ''}
                      </span>
                      {rank && (
                        <span className="shrink-0 text-xs text-muted-foreground">{rank}</span>
                      )}
                      {m.banned && (
                        <span className="shrink-0 text-xs text-destructive">{t('banned')}</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className={cn(m.online && 'text-primary')}>{status}</span>
                      {role && ` · ${role}`}
                    </span>
                  </span>
                </ProfileLink>
                <button
                  type="button"
                  aria-label={t('memberActions')}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setMemberMenu({ m, x: r.right - 208, y: r.bottom + 4 })
                  }}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                >
                  <MoreVertical className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {memberMenu && (
        <MemberActionsMenu
          x={memberMenu.x}
          y={memberMenu.y}
          items={memberItems(memberMenu.m)}
          onClose={() => setMemberMenu(null)}
        />
      )}
    </>
  )
}
