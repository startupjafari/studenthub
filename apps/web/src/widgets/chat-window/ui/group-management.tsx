'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Ban,
  ChevronRight,
  Check,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Share2,
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
import { Button, Skeleton, useConfirm } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { ChatMembersList } from './chat-members-list'
import {
  CardHint,
  MANAGE_ROW,
  ManageEmpty,
  ManageSearch,
  PERSON_ROW,
  PersonAvatar,
  PersonRowsSkeleton,
} from './group-manage-kit'
import {
  GroupTypeScreen,
  JoinRequestsScreen,
  PermissionsScreen,
  RemovedScreen,
  allowedCount,
  useJoinRequests,
} from './group-permissions'
import { InfoCard } from './profile-info-card'

/**
 * Управление группой в правой колонке (Telegram-стиль: карандаш в шапке профиля).
 *
 * Экраны сменяют друг друга внутри той же колонки, «назад» в шапке возвращает на шаг:
 * название, описание и фото (окно редактирования), тип группы, ссылка-приглашение,
 * «Разрешения» участников, заявки на вступление, администраторы, участники, заблокированные,
 * исключённые («Удалённые») и удаление группы (§8.3). Экраны прав и заявок —
 * group-permissions.tsx, общие детали экранов (секции, поиск, пустота) — group-manage-kit.tsx.
 */
export type ManageScreen =
  | 'main'
  | 'editInfo'
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
  editInfo: 'editGroup',
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

const errorCode = (e: unknown): string => (e as { code?: string }).code ?? 'INTERNAL_ERROR'

/**
 * Строка-переход: иконка, подпись, значение и шеврон. Пока значение грузится (`loading`),
 * на его месте — короткая заглушка: число не выскакивает из пустоты и не сдвигает подпись.
 */
function NavRow({
  icon: Icon,
  label,
  value,
  loading = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value?: string | number
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={MANAGE_ROW}>
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value !== undefined ? (
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums duration-(--motion-page) animate-in fade-in-0">
          {value}
        </span>
      ) : (
        loading && <Skeleton className="h-3.5 w-6 shrink-0" aria-hidden />
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  )
}

export function GroupManagement({
  chat,
  myId,
  screen,
  onNavigate,
  onEditInfo,
  onOpenChat,
  onLeft,
  enterFrom = 'right',
}: {
  chat: ChatListItem
  myId: string | undefined
  screen: ManageScreen
  /** Откуда въезжает экран: вглубь — справа, «назад» — слева (как в Telegram и iOS). */
  enterFrom?: 'right' | 'left'
  onNavigate: (screen: ManageScreen) => void
  /** Открыть окно названия, описания и фото. */
  onEditInfo: () => void
  onOpenChat: (chatId: string) => void
  /** Группа удалена — родитель закрывает панель и сбрасывает чат. */
  onLeft: () => void
}) {
  const t = useTranslations('Chats')
  // Экран въезжает со стороны шага: вглубь — справа, назад — слева; блоки экрана — каскадом.
  return (
    <div
      key={screen}
      className={cn(
        'sh-stagger flex min-h-full flex-col pb-6 duration-(--motion-page) animate-in fade-in-0',
        enterFrom === 'right' ? 'slide-in-from-right-8' : 'slide-in-from-left-8',
      )}
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
                className={cn(MANAGE_ROW, 'text-primary')}
              >
                <ShieldPlus className="size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t('tgRight.addAdmin')}</span>
              </button>
            </InfoCard>
          )}
          <div>
            <ChatMembersList
              chat={chat}
              myId={myId}
              onOpenChat={onOpenChat}
              filter="admins"
              variant="manage"
            />
          </div>
        </>
      )}
      {screen === 'addAdmin' && (
        <AddAdminScreen chat={chat} myId={myId} onDone={() => onNavigate('admins')} />
      )}
      {screen === 'members' && (
        <div>
          <ChatMembersList chat={chat} myId={myId} onOpenChat={onOpenChat} variant="manage" />
        </div>
      )}
      {screen === 'banned' && (
        <div>
          <ChatMembersList
            chat={chat}
            myId={myId}
            onOpenChat={onOpenChat}
            filter="banned"
            variant="manage"
          />
        </div>
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
    onError: (e: unknown) => toast.error(tErr(errorCode(e))),
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
              loading={requests.isLoading}
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
          loading={members.isLoading}
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
          loading={members.isLoading}
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
            className={cn(MANAGE_ROW, 'text-destructive')}
          >
            {remove.isPending ? (
              <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">{t('deleteGroup')}</span>
          </button>
        </InfoCard>
      )}
    </>
  )
}

/**
 * Ссылка-приглашение: моноширинным блоком в две строки (полностью — в подсказке и при
 * выделении), «Скопировать» и «Поделиться» под ней, смена ссылки — отдельной красной строкой
 * ниже, как «Сбросить ссылку» в Telegram: необратимое не стоит рядом с повседневным.
 */
function InviteScreen({ chat }: { chat: ChatListItem }) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
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
  // Системное «Поделиться» есть не везде (десктопный Firefox, часть Linux) — там кнопки нет,
  // а не кнопка, которая ничего не делает. Экран рисуется только в браузере (колонка чата),
  // поэтому проверка прямо в рендере не расходится с серверной разметкой.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const reset = useMutation({
    mutationFn: () => resetChatInviteCode(chat.id),
    onSuccess: (code) => {
      qc.setQueryData(chatKeys.invite(chat.id), code)
      toast.success(t('tgRight.inviteResetDone'))
    },
    onError: (e: unknown) => toast.error(tErr(errorCode(e))),
  })

  // Кнопка сама подтверждает копирование («Скопировано ✓» на пару секунд), как в веб-
  // приложениях: тост внизу легко пропустить, а глаза в этот момент смотрят на кнопку.
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])
  const copy = async (): Promise<void> => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t('linkCopied'))
    } catch {
      toast.error(t('tgStickers.linkCopyFailed'))
    }
  }
  const share = async (): Promise<void> => {
    if (!url) return
    try {
      await navigator.share({
        url,
        ...(chat.title ? { text: t('tgRight.inviteShareText', { title: chat.title }) } : {}),
      })
    } catch (e) {
      // Закрыл лист «Поделиться» сам — это не ошибка. Иначе (запрет, сбой) — хотя бы копия
      // в буфер, чтобы нажатие не прошло впустую.
      if ((e as { name?: string }).name !== 'AbortError') void copy()
    }
  }

  if (invite.isError && !invite.data) {
    return (
      <ManageEmpty
        icon={Link2}
        title={t('sharedLoadError')}
        action={
          <Button variant="outline" size="sm" onClick={() => void invite.refetch()}>
            <RotateCcw aria-hidden />
            {tCommon('retry')}
          </Button>
        }
      />
    )
  }
  return (
    <>
      <InfoCard className="mt-3 p-4">
        {url ? (
          // key — ссылка: сменили её — новая проявляется, видно, что она другая. Высота блока
          // закреплена за две строки — та же, что у заглушки: ссылка встаёт без сдвига.
          <p
            key={url}
            title={url}
            className="flex min-h-15 items-center rounded-lg border border-input bg-muted/40 px-3 py-2.5 font-mono text-[0.8125rem] leading-5 duration-(--motion-page) animate-in fade-in-0"
          >
            <span className="line-clamp-2 break-all select-all">
              {url.replace(/^https?:\/\//, '')}
            </span>
          </p>
        ) : (
          <Skeleton className="h-15 w-full rounded-lg" />
        )}
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1"
            variant={copied ? 'secondary' : 'default'}
            disabled={!url}
            onClick={() => void copy()}
          >
            <span className="relative size-4" aria-hidden>
              <Copy
                className={cn(
                  'absolute inset-0 size-4 transition-[opacity,scale] duration-(--motion-control)',
                  copied ? 'scale-50 opacity-0' : 'opacity-100',
                )}
              />
              <Check
                className={cn(
                  'absolute inset-0 size-4 transition-[opacity,scale] duration-(--motion-control)',
                  copied ? 'opacity-100' : 'scale-50 opacity-0',
                )}
              />
            </span>
            {copied ? t('tgRight.inviteCopiedShort') : t('tgRight.inviteCopy')}
          </Button>
          {canShare && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={!url}
              onClick={() => void share()}
            >
              <Share2 aria-hidden />
              {t('tgRight.inviteShare')}
            </Button>
          )}
        </div>
      </InfoCard>
      <CardHint>{t('tgRight.inviteHint')}</CardHint>
      <InfoCard className="mt-5">
        <button
          type="button"
          disabled={!url || reset.isPending}
          onClick={() => {
            void confirm({ title: t('tgRight.inviteResetConfirm'), destructive: true }).then(
              (ok) => {
                if (ok) reset.mutate()
              },
            )
          }}
          className={cn(MANAGE_ROW, 'text-destructive')}
        >
          {reset.isPending ? (
            <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="size-5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{t('tgRight.inviteReset')}</span>
        </button>
      </InfoCard>
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
  const tCommon = useTranslations('Common')
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
    onError: (e: unknown) => toast.error(tErr(errorCode(e))),
  })

  return (
    <>
      <ManageSearch value={query} onChange={setQuery} placeholder={t('tgRight.searchMembers')} />
      {members.isLoading ? (
        <PersonRowsSkeleton rows={6} />
      ) : members.isError && !members.data ? (
        <ManageEmpty
          icon={Users}
          title={t('sharedLoadError')}
          action={
            <Button variant="outline" size="sm" onClick={() => void members.refetch()}>
              <RotateCcw aria-hidden />
              {tCommon('retry')}
            </Button>
          }
        />
      ) : candidates.length === 0 ? (
        query.trim() ? (
          <ManageEmpty
            icon={Search}
            title={t('tgRight.nothingFound')}
            hint={t('tgRight.nothingFoundHint')}
          />
        ) : (
          <ManageEmpty icon={Shield} title={t('tgRight.addAdminEmpty')} />
        )
      ) : (
        <ul className="py-1">
          {candidates.map((m) => {
            const name = `${m.lastName} ${m.firstName}`.trim()
            const granting = grant.isPending && grant.variables === m.id
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={grant.isPending}
                  onClick={() => grant.mutate(m.id)}
                  className={cn(
                    'group flex w-full items-center gap-3 px-4 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:cursor-not-allowed',
                    PERSON_ROW,
                    grant.isPending && !granting && 'opacity-60',
                  )}
                >
                  <PersonAvatar id={m.id} name={name} url={m.avatarUrl} online={m.online} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                  {/* Что сделает нажатие — значком справа при наведении; во время запроса —
                      крутилка на выбранной строке. */}
                  {granting ? (
                    <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
                  ) : (
                    <ShieldPlus
                      className="size-5 shrink-0 text-primary opacity-0 transition-opacity duration-(--motion-micro) group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                  )}
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
    onError: (e: unknown) => toast.error(tErr(errorCode(e))),
  })
  return (
    <div className="flex flex-col px-3 pt-3 pb-6 duration-(--motion-page) animate-in fade-in-0 slide-in-from-right-4">
      <UserPicker inline value={null} onSelect={(u) => u && !add.isPending && add.mutate(u.id)} />
      <p className="mt-2 px-1 text-xs text-muted-foreground">{t('tgRight.addMembersHint')}</p>
    </div>
  )
}
