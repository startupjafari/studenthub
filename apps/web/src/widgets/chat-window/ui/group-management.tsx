'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Ban,
  ChevronRight,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Pencil,
  RotateCcw,
  Search,
  Shield,
  ShieldPlus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  addChatMemberRequest,
  chatKeys,
  deleteChatRequest,
  fetchChatInviteCode,
  fetchChatMembers,
  resetChatInviteCode,
  setChatAdminRequest,
  type ChatListItem,
} from '../../../entities/chat'
import { UserPicker } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { identityColor, identityInitials } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import { ChatMembersList } from './chat-members-list'
import {
  GroupTypeScreen,
  JoinRequestsScreen,
  PermissionsScreen,
  RemovedScreen,
  allowedCount,
  useJoinRequests,
} from './group-permissions'
import { InfoCard } from './profile-info-card'
import { TabEmpty, TabError } from './shared-media'

/**
 * Управление группой в правой колонке (Telegram-стиль: карандаш в шапке профиля).
 *
 * Экраны сменяют друг друга внутри той же колонки, «назад» в шапке возвращает на шаг:
 * название, описание и фото (окно редактирования), тип группы, ссылка-приглашение,
 * «Разрешения» участников, заявки на вступление, администраторы, участники, заблокированные,
 * исключённые («Удалённые») и удаление группы (§8.3). Экраны прав и заявок —
 * group-permissions.tsx.
 */
export type ManageScreen =
  | 'main'
  | 'invite'
  | 'admins'
  | 'addAdmin'
  | 'members'
  | 'banned'
  | 'permissions'
  | 'groupType'
  | 'joinRequests'
  | 'removed'

/** Экран, на который ведёт «назад» с данного. */
export function manageParent(screen: ManageScreen): ManageScreen | null {
  if (screen === 'main') return null
  if (screen === 'addAdmin') return 'admins'
  return 'main'
}

/** Ключ заголовка шапки для экрана управления. */
export const MANAGE_TITLE: Record<ManageScreen, string> = {
  main: 'tgRight.manageTitle',
  invite: 'tgRight.inviteLink',
  admins: 'tgRight.admins',
  addAdmin: 'tgRight.addAdmin',
  members: 'tabParticipants',
  banned: 'tgRight.banned',
  permissions: 'tgGroups.permissions',
  groupType: 'tgGroups.groupType',
  joinRequests: 'tgGroups.joinRequests',
  removed: 'tgGroups.removed',
}

const ROW =
  'flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left text-[0.9375rem] outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60'

function NavRow({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value?: string | number
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value !== undefined && (
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{value}</span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

/** Подпись под карточкой — пояснение, как у секций настроек Telegram. */
function CardHint({ children }: { children: React.ReactNode }) {
  return <p className="mx-3 mt-2 px-4 text-xs text-muted-foreground">{children}</p>
}

export function GroupManagement({
  chat,
  myId,
  screen,
  onNavigate,
  onEditInfo,
  onOpenChat,
  onLeft,
}: {
  chat: ChatListItem
  myId: string | undefined
  screen: ManageScreen
  onNavigate: (screen: ManageScreen) => void
  /** Открыть окно названия, описания и фото. */
  onEditInfo: () => void
  onOpenChat: (chatId: string) => void
  /** Группа удалена — родитель закрывает панель и сбрасывает чат. */
  onLeft: () => void
}) {
  const t = useTranslations('Chats')
  // Экран входит сдвигом справа: каждый шаг управления — вглубь, как в Telegram.
  return (
    <div
      key={screen}
      className="flex min-h-full flex-col pb-6 duration-(--motion-page) animate-in fade-in-0 slide-in-from-right-4"
    >
      {screen === 'main' && (
        <ManageMain chat={chat} onNavigate={onNavigate} onEditInfo={onEditInfo} onLeft={onLeft} />
      )}
      {screen === 'invite' && <InviteScreen chat={chat} />}
      {screen === 'admins' && (
        <>
          {chat.isOwner && (
            <InfoCard className="mt-3">
              <button
                type="button"
                onClick={() => onNavigate('addAdmin')}
                className={cn(ROW, 'text-primary')}
              >
                <ShieldPlus className="size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t('tgRight.addAdmin')}</span>
              </button>
            </InfoCard>
          )}
          <div className="mt-2">
            <ChatMembersList chat={chat} myId={myId} onOpenChat={onOpenChat} filter="admins" />
          </div>
        </>
      )}
      {screen === 'addAdmin' && (
        <AddAdminScreen chat={chat} myId={myId} onDone={() => onNavigate('admins')} />
      )}
      {screen === 'members' && <MembersScreen chat={chat} myId={myId} onOpenChat={onOpenChat} />}
      {screen === 'banned' && (
        <>
          <CardHint>{t('tgRight.bannedHint')}</CardHint>
          <ChatMembersList chat={chat} myId={myId} onOpenChat={onOpenChat} filter="banned" />
        </>
      )}
      {screen === 'permissions' && <PermissionsScreen chat={chat} />}
      {screen === 'groupType' && <GroupTypeScreen chat={chat} />}
      {screen === 'joinRequests' && <JoinRequestsScreen chat={chat} />}
      {screen === 'removed' && <RemovedScreen chat={chat} />}
    </div>
  )
}

function ManageMain({
  chat,
  onNavigate,
  onEditInfo,
  onLeft,
}: {
  chat: ChatListItem
  onNavigate: (screen: ManageScreen) => void
  onEditInfo: () => void
  onLeft: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const members = useQuery({
    queryKey: chatKeys.members(chat.id),
    queryFn: () => fetchChatMembers(chat.id),
  })
  const list = members.data ?? []
  const admins = list.filter((m) => m.isAdmin && !m.banned).length
  const banned = list.filter((m) => m.banned).length
  const active = list.filter((m) => !m.banned).length || chat.memberCount
  const isUserGroup = chat.type === 'GROUP'
  // Права, тип группы, заявки и исключённые — только у пользовательской группы и только
  // админам: официальные чаты ведёт вуз, их состав и правила здесь не меняются.
  const canModerate = isUserGroup && (chat.isAdmin || chat.isOwner)
  const byLink = chat.joinByLink !== false
  const requests = useJoinRequests(chat, canModerate)
  const pendingRequests = requests.data?.length ?? 0

  const remove = useMutation({
    mutationFn: () => deleteChatRequest(chat.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      void qc.invalidateQueries({ queryKey: chatKeys.unread() })
      onLeft()
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <>
      <InfoCard className="mt-3">
        <NavRow icon={Pencil} label={t('tgRight.manageInfo')} onClick={onEditInfo} />
        {canModerate && (
          <NavRow
            icon={Globe}
            label={t('tgGroups.groupType')}
            value={byLink ? t('tgGroups.typeByLink') : t('tgGroups.typeClosed')}
            onClick={() => onNavigate('groupType')}
          />
        )}
        {isUserGroup && chat.isAdmin && byLink && (
          <NavRow
            icon={Link2}
            label={t('tgRight.inviteLink')}
            onClick={() => onNavigate('invite')}
          />
        )}
      </InfoCard>

      {canModerate && (
        <InfoCard className="mt-3">
          <NavRow
            icon={KeyRound}
            label={t('tgGroups.permissions')}
            value={t('tgGroups.permsAllowed', { count: allowedCount(chat), total: 8 })}
            onClick={() => onNavigate('permissions')}
          />
          {(chat.joinApproval === true || pendingRequests > 0) && (
            <NavRow
              icon={UserPlus}
              label={t('tgGroups.joinRequests')}
              value={requests.data ? pendingRequests : undefined}
              onClick={() => onNavigate('joinRequests')}
            />
          )}
        </InfoCard>
      )}

      <InfoCard className="mt-3">
        <NavRow
          icon={Shield}
          label={t('tgRight.admins')}
          value={members.data ? admins : undefined}
          onClick={() => onNavigate('admins')}
        />
        <NavRow
          icon={Users}
          label={t('tabParticipants')}
          value={active}
          onClick={() => onNavigate('members')}
        />
        <NavRow
          icon={Ban}
          label={t('tgRight.banned')}
          value={members.data ? banned : undefined}
          onClick={() => onNavigate('banned')}
        />
        {canModerate && (
          <NavRow
            icon={UserMinus}
            label={t('tgGroups.removed')}
            onClick={() => onNavigate('removed')}
          />
        )}
      </InfoCard>

      {isUserGroup && chat.isOwner && (
        <InfoCard className="mt-3">
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              void confirm({ title: t('deleteGroupConfirm'), destructive: true }).then((ok) => {
                if (ok) remove.mutate()
              })
            }}
            className={cn(ROW, 'text-destructive')}
          >
            <Trash2 className="size-5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('deleteGroup')}</span>
          </button>
        </InfoCard>
      )}
    </>
  )
}

/** Ссылка-приглашение: видна целиком, копируется одной кнопкой, меняется с подтверждением. */
function InviteScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const invite = useQuery({
    queryKey: chatKeys.invite(chat.id),
    queryFn: () => fetchChatInviteCode(chat.id),
    staleTime: 5 * 60 * 1000,
  })
  const url = invite.data
    ? `${window.location.origin}/join-chat/${chat.id}?k=${encodeURIComponent(invite.data)}`
    : null

  const reset = useMutation({
    mutationFn: () => resetChatInviteCode(chat.id),
    onSuccess: (code) => {
      qc.setQueryData(chatKeys.invite(chat.id), code)
      toast.success(t('tgRight.inviteResetDone'))
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  const copy = (): void => {
    if (!url) return
    void navigator.clipboard?.writeText(url)
    toast.success(t('linkCopied'))
  }

  if (invite.isError && !invite.data) return <TabError onRetry={() => void invite.refetch()} />
  return (
    <>
      <InfoCard className="mt-3 p-4">
        {url ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm break-all select-all">
            {url.replace(/^https?:\/\//, '')}
          </p>
        ) : (
          <Skeleton className="h-10 w-full rounded-lg" />
        )}
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" disabled={!url} onClick={copy}>
            <Copy aria-hidden />
            {t('copyLink')}
          </Button>
          <Button
            variant="outline"
            disabled={!url}
            loading={reset.isPending}
            onClick={() => {
              void confirm({ title: t('tgRight.inviteResetConfirm'), destructive: true }).then(
                (ok) => {
                  if (ok) reset.mutate()
                },
              )
            }}
          >
            <RotateCcw aria-hidden />
            {t('tgRight.inviteReset')}
          </Button>
        </div>
      </InfoCard>
      <CardHint>{t('tgRight.inviteHint')}</CardHint>
    </>
  )
}

/** Поле поиска внутри колонки (того же вида, что поиск панелей левой колонки). */
function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative mx-3 mt-3">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-input bg-background pr-3 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15"
      />
    </div>
  )
}

function MembersScreen({
  chat,
  myId,
  onOpenChat,
}: {
  chat: ChatListItem
  myId: string | undefined
  onOpenChat: (chatId: string) => void
}) {
  const t = useTranslations('Chats')
  const [query, setQuery] = useState('')
  return (
    <>
      <SearchField value={query} onChange={setQuery} placeholder={t('tgRight.searchMembers')} />
      <div className="mt-1">
        <ChatMembersList chat={chat} myId={myId} onOpenChat={onOpenChat} query={query} />
      </div>
    </>
  )
}

/** Назначить администратора: выбор из участников группы, ещё не админов и не исключённых. */
function AddAdminScreen({
  chat,
  myId,
  onDone,
}: {
  chat: ChatListItem
  myId: string | undefined
  onDone: () => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const members = useQuery({
    queryKey: chatKeys.members(chat.id),
    queryFn: () => fetchChatMembers(chat.id),
  })
  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return (members.data ?? []).filter(
      (m) =>
        !m.isAdmin &&
        !m.banned &&
        m.id !== myId &&
        (!needle || `${m.lastName} ${m.firstName}`.toLocaleLowerCase().includes(needle)),
    )
  }, [members.data, query, myId])

  const grant = useMutation({
    mutationFn: (userId: string) => setChatAdminRequest(chat.id, userId, true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
      toast.success(t('adminGranted'))
      onDone()
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <>
      <SearchField value={query} onChange={setQuery} placeholder={t('tgRight.searchMembers')} />
      {members.isLoading ? (
        <div className="mt-2 flex flex-col gap-1 px-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : members.isError && !members.data ? (
        <TabError onRetry={() => void members.refetch()} />
      ) : candidates.length === 0 ? (
        <TabEmpty
          icon={<Users className="size-6" aria-hidden />}
          title={query.trim() ? t('tgRight.nothingFound') : t('sharedEmpty')}
        />
      ) : (
        <ul className="mt-1 py-1">
          {candidates.map((m) => {
            const name = `${m.lastName} ${m.firstName}`.trim()
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={grant.isPending}
                  onClick={() => grant.mutate(m.id)}
                  className="flex w-full items-center gap-3 px-4 py-1.5 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:opacity-60"
                >
                  <Avatar className="size-11">
                    {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={name} />}
                    <AvatarFallback className={cn('text-white', identityColor(m.id))}>
                      {identityInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** Добавить участников: поиск человека и добавление сразу (FAB на вкладке «Участники»). */
export function AddMembersScreen({ chat, onDone }: { chat: ChatListItem; onDone: () => void }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: (userId: string) => addChatMemberRequest(chat.id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('memberAdded'))
      onDone()
    },
    onError: (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })
  return (
    <div className="flex flex-col px-3 pt-3 pb-6 duration-(--motion-page) animate-in fade-in-0 slide-in-from-right-4">
      <UserPicker inline value={null} onSelect={(u) => u && !add.isPending && add.mutate(u.id)} />
      <p className="mt-2 px-1 text-xs text-muted-foreground">{t('tgRight.addMembersHint')}</p>
    </div>
  )
}
