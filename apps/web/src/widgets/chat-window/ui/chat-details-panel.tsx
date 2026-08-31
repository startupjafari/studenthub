'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Ban,
  Bell,
  BellOff,
  Check,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  MoreVertical,
  Pencil,
  Play,
  Shield,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import {
  addChatMemberRequest,
  banChatMemberRequest,
  blockUserRequest,
  chatKeys,
  createChatRequest,
  fetchAttachmentUrl,
  fetchBlockedUsers,
  fetchChatLinks,
  fetchChatMedia,
  fetchChatMembers,
  removeChatMemberRequest,
  setChatAdminRequest,
  transferOwnershipRequest,
  unbanChatMemberRequest,
  unblockUserRequest,
  MediaViewer,
  type ChatLinkItem,
  type ChatListItem,
  type ChatMediaItem,
  type ChatMemberInfo,
} from '../../../entities/chat'
import { ProfileLink, UserPicker } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

import { identityColor, identityInitials } from '../../../shared/lib'
import { MemberActionsMenu, type MemberMenuItem } from './member-actions-menu'
import { EditGroupDialog } from './edit-group-dialog'

// §17: варианты «заглушить на время».
const MUTE_DURATIONS: { key: string; mode: number | 'forever' }[] = [
  { key: 'mute1h', mode: 60 },
  { key: 'mute4h', mode: 240 },
  { key: 'mute8h', mode: 480 },
  { key: 'mute1d', mode: 1440 },
  { key: 'mute3d', mode: 4320 },
  { key: 'muteForever', mode: 'forever' },
]

// Панель вкладки: flex-колонка минимум на всю высоту скролл-контейнера — от неё
// считают высоту пустое состояние и скелетон. `data-[state=active]:flex`, а не `flex`:
// у неактивной вкладки Radix ставит атрибут `hidden`, и класс display его бы перебил.
const TAB_PANE = 'mt-0 min-h-full flex-col data-[state=active]:flex'

// Плейсхолдеров рисуем с запасом на любую высоту панели: контейнер скелетона —
// `flex-1 overflow-hidden`, поэтому лишние строки обрезаются, а пустоты снизу нет.
const SKELETON_ROWS = 16
const SKELETON_TILES = 24

// §49: относительное «был N назад» из ISO last-seen.
function lastSeenText(iso: string, t: (k: string, v?: Record<string, number>) => string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return t('lastSeenNow')
  if (min < 60) return t('lastSeenMin', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('lastSeenHour', { count: hr })
  return t('lastSeenDay', { count: Math.floor(hr / 24) })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// presigned-URL вложения (кэш общий с сообщениями: тот же ключ ['chat-attachment', id]).
function useFileUrl(fileId: string, enabled = true) {
  return useQuery({
    queryKey: ['chat-attachment', fileId],
    queryFn: () => fetchAttachmentUrl(fileId),
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })
}

// Пустое состояние вкладки: обёртка — flex-колонка, чтобы `flex-1` внутри EmptyState
// растянул пунктирный блок на всю доступную высоту панели, а не полоской у верхнего края.
function Empty({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <EmptyState icon={icon} title={title} />
    </div>
  )
}

function LoadMore({
  onClick,
  loading,
  label,
}: {
  onClick: () => void
  loading: boolean
  label: string
}) {
  return (
    <div className="p-2">
      <Button variant="ghost" size="sm" className="w-full" onClick={onClick} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : label}
      </Button>
    </div>
  )
}

// ── Медиа: сетка миниатюр → fullscreen viewer (§42) ──────────────────────────
function MediaThumb({ item, onOpen }: { item: ChatMediaItem; onOpen: () => void }) {
  const isVideo = item.mime.startsWith('video/')
  const url = useFileUrl(item.id)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-square overflow-hidden rounded-md bg-muted"
    >
      {url.data ? (
        isVideo ? (
          <video src={url.data} muted preload="metadata" className="size-full object-cover" />
        ) : (
          <img src={url.data} alt="" loading="lazy" className="size-full object-cover" />
        )
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
          <Play className="size-5" aria-hidden />
        </span>
      )}
    </button>
  )
}

function MediaTab({ chatId }: { chatId: string }) {
  const t = useTranslations('Chats')
  const [viewer, setViewer] = useState<number | null>(null)
  const q = useInfiniteQuery({
    queryKey: chatKeys.media(chatId, 'media'),
    queryFn: ({ pageParam }) => fetchChatMedia(chatId, 'media', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-1 overflow-hidden p-1">
        {Array.from({ length: SKELETON_TILES }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    )
  }
  if (items.length === 0)
    return <Empty icon={<ImageIcon className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  // Для fullscreen-viewer маппим ChatMediaItem → MessageAttachment (viewer сам тянет presigned-URL).
  const attachments = items.map((it) => ({
    id: it.id,
    mime: it.mime,
    size: it.size,
    name: it.name,
  }))
  return (
    <>
      <div className="grid grid-cols-3 gap-1 p-1">
        {items.map((it, i) => (
          <MediaThumb key={it.id} item={it} onOpen={() => setViewer(i)} />
        ))}
      </div>
      {q.hasNextPage && (
        <LoadMore
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          label={t('loadMore')}
        />
      )}
      {viewer !== null && (
        <MediaViewer
          items={attachments}
          index={viewer}
          onIndexChange={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  )
}

// ── Файлы / Голос: список ────────────────────────────────────────────────────
function FileRow({
  item,
  voice,
  onJump,
  locale,
}: {
  item: ChatMediaItem
  voice: boolean
  onJump: (id: string) => void
  locale: string
}) {
  const t = useTranslations('Chats')
  // Для голосовых сразу подгружаем URL (нативный плеер); для файлов — по клику на скачивание.
  const url = useFileUrl(item.id, voice)
  const dl = useFileUrl(item.id, false)
  const date = new Date(item.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  })
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {voice ? (
            <Mic className="size-4" aria-hidden />
          ) : (
            <FileText className="size-4" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.name ?? t('attachment')}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatBytes(item.size)} · {date}
          </span>
        </span>
      </button>
      {voice ? (
        url.data ? (
          <audio src={url.data} controls preload="none" className="h-8 w-32 shrink-0" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        )
      ) : (
        <button
          type="button"
          aria-label={t('download')}
          onClick={() => void dl.refetch().then((r) => r.data && window.open(r.data, '_blank'))}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function FileTab({
  chatId,
  voice,
  onJump,
}: {
  chatId: string
  voice: boolean
  onJump: (id: string) => void
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const type = voice ? 'voice' : 'file'
  const q = useInfiniteQuery({
    queryKey: chatKeys.media(chatId, type),
    queryFn: ({ pageParam }) => fetchChatMedia(chatId, type, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden p-2">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    )
  }
  if (items.length === 0) {
    const icon = voice ? (
      <Mic className="size-6" aria-hidden />
    ) : (
      <FileText className="size-6" aria-hidden />
    )
    return <Empty icon={icon} title={t('sharedEmpty')} />
  }
  return (
    <>
      {items.map((it) => (
        <FileRow key={it.id} item={it} voice={voice} onJump={onJump} locale={locale} />
      ))}
      {q.hasNextPage && (
        <LoadMore
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          label={t('loadMore')}
        />
      )}
    </>
  )
}

// ── Ссылки: список ───────────────────────────────────────────────────────────
function LinkRow({
  item,
  onJump,
  locale,
}: {
  item: ChatLinkItem
  onJump: (id: string) => void
  locale: string
}) {
  const t = useTranslations('Chats')
  const lp = item.linkPreview
  if (!lp) return null
  let host = lp.url
  try {
    host = new URL(lp.url).hostname.replace(/^www\./, '')
  } catch {
    /* оставляем как есть */
  }
  const date = new Date(item.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  })
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={() => onJump(item.messageId)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Link2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lp.title || host}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {host} · {date}
          </span>
        </span>
      </button>
      <a
        href={lp.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('openLink')}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    </div>
  )
}

function LinksTab({ chatId, onJump }: { chatId: string; onJump: (id: string) => void }) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const q = useInfiniteQuery({
    queryKey: chatKeys.links(chatId),
    queryFn: ({ pageParam }) => fetchChatLinks(chatId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasNext ? last.cursor : undefined),
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-1 overflow-hidden p-2">
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <Skeleton className="h-4 w-44" />
          </div>
        ))}
      </div>
    )
  }
  if (items.length === 0)
    return <Empty icon={<Link2 className="size-6" aria-hidden />} title={t('sharedEmpty')} />
  return (
    <>
      {items.map((it) => (
        <LinkRow key={it.messageId} item={it} onJump={onJump} locale={locale} />
      ))}
      {q.hasNextPage && (
        <LoadMore
          onClick={() => void q.fetchNextPage()}
          loading={q.isFetchingNextPage}
          label={t('loadMore')}
        />
      )}
    </>
  )
}

// ── Участники: список + управление составом группы (§9) ──────────────────────
function ParticipantsTab({
  chat,
  myId,
  onOpenChat,
}: {
  chat: ChatListItem
  myId: string | undefined
  onOpenChat: (chatId: string) => void
}) {
  const t = useTranslations('Chats')
  const tr = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const router = useRouter()
  const confirm = useConfirm()
  const [adding, setAdding] = useState(false)
  // Меню действий над участником (ПКМ по строке или кнопка «три точки»).
  const [memberMenu, setMemberMenu] = useState<{ m: ChatMemberInfo; x: number; y: number } | null>(
    null,
  )

  const members = useQuery({
    queryKey: chatKeys.members(chat.id),
    queryFn: () => fetchChatMembers(chat.id),
  })
  const list = members.data ?? []
  // Мои персональные блокировки — чтобы показывать «Заблокировать»/«Разблокировать» по факту.
  const blockedQuery = useQuery({ queryKey: chatKeys.blocked(), queryFn: fetchBlockedUsers })
  const blockedIds = new Set((blockedQuery.data ?? []).map((b) => b.id))

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidateMembers = () => {
    void qc.invalidateQueries({ queryKey: chatKeys.members(chat.id) })
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  }

  const addMember = useMutation({
    mutationFn: (userId: string) => addChatMemberRequest(chat.id, userId),
    onSuccess: () => {
      invalidateMembers()
      setAdding(false)
      toast.success(t('memberAdded'))
    },
    onError: err,
  })

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

  // Пункты меню действий над участником — по правам смотрящего (владелец/админ) и статусу участника.
  function memberItems(m: ChatMemberInfo): MemberMenuItem[] {
    const items: MemberMenuItem[] = [
      {
        key: 'profile',
        label: t('openProfile'),
        icon: UserRound,
        onClick: () => router.push(`/profile/${m.id}`),
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
    if (chat.isAdmin && m.id !== myId && (!m.isAdmin || m.banned)) {
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
    if ((chat.isOwner || (chat.isAdmin && !m.isAdmin)) && m.id !== myId) {
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

  return (
    <>
      {/* Шапка вкладки: счётчик + ссылка-приглашение и добавление участника (для админов). */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('participants', { count: list.length || chat.memberCount })}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={t('inviteLink')}
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/join-chat/${chat.id}`)
              toast.success(t('linkCopied'))
            }}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Link2 className="size-4" aria-hidden />
          </button>
          {chat.isAdmin && (
            <button
              type="button"
              aria-label={t('addMember')}
              onClick={() => setAdding((v) => !v)}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                adding && 'bg-muted text-foreground',
              )}
            >
              <UserPlus className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="shrink-0 px-3 pb-2 duration-150 animate-in fade-in slide-in-from-top-1">
          <UserPicker value={null} onSelect={(u) => u && addMember.mutate(u.id)} />
        </div>
      )}

      {members.isLoading ? (
        <div className="min-h-0 flex-1 space-y-1 overflow-hidden p-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <Empty icon={<Users className="size-6" aria-hidden />} title={t('sharedEmpty')} />
      ) : (
        <ul>
          {list.map((m) => {
            const name = `${m.lastName} ${m.firstName}`.trim()
            return (
              <li key={m.id}>
                <div
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMemberMenu({ m, x: e.clientX, y: e.clientY })
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2',
                    m.banned && 'opacity-60',
                  )}
                >
                  <ProfileLink userId={m.id} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="relative shrink-0">
                      <Avatar className="size-9">
                        {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={name} />}
                        <AvatarFallback className={cn('text-white', identityColor(m.id))}>
                          {identityInitials(name)}
                        </AvatarFallback>
                      </Avatar>
                      {m.online && (
                        <span
                          className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-background bg-success"
                          aria-hidden
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {name}
                          {m.id === myId ? ` (${t('you')})` : ''}
                        </span>
                        {m.isAdmin && !m.banned && (
                          <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-primary">
                            <Shield className="size-3" aria-hidden />
                            {t('adminBadge')}
                          </span>
                        )}
                        {m.banned && (
                          <span className="shrink-0 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-destructive">
                            {t('banned')}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.online
                          ? tr(m.role)
                          : m.lastSeenAt
                            ? lastSeenText(m.lastSeenAt, t)
                            : tr(m.role)}
                      </span>
                    </span>
                  </ProfileLink>
                  {/* Действия над участником — в меню (ПКМ по строке или эта кнопка). */}
                  <button
                    type="button"
                    aria-label={t('memberActions')}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setMemberMenu({ m, x: r.right - 208, y: r.bottom + 4 })
                    }}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreVertical className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

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

// Панель деталей чата (Telegram-стиль §55): профиль + управление + вкладки
// Участники / Медиа / Файлы / Ссылки / Голос (§23, реальные данные из gallery-эндпоинтов).
//
// Одна панель на все размеры экрана — второго экрана с тем же содержимым нет:
// `variant='column'` — докнутая третья колонка на ПК (≥xl), со своей шапкой и крестиком;
// `variant='modal'` — та же панель внутри системного Modal на планшете и мобильном
// (шапку и крестик даёт Modal). Клик по материалу — onJump к сообщению-источнику.
export function ChatDetailsPanel({
  chat,
  title,
  isPrivate,
  peerOnline = false,
  myId,
  variant = 'column',
  onClose,
  onMute,
  onUnmute,
  onOpenPeerProfile,
  onJump,
  onLeft,
  onOpenChat,
}: {
  chat: ChatListItem
  title: string
  isPrivate: boolean
  peerOnline?: boolean
  myId: string | undefined
  variant?: 'column' | 'modal'
  onClose: () => void
  // §17: заглушить на время (minutes) или навсегда ('forever'); onUnmute — включить.
  // importantOnly — режим «только важные»: ответы мне и упоминания уведомляют и в mute.
  onMute: (mode: number | 'forever', importantOnly?: boolean) => void
  onUnmute: () => void
  onOpenPeerProfile?: () => void
  onJump: (messageId: string) => void
  // Вышел из группы — родитель закрывает панель и сбрасывает активный чат.
  onLeft: () => void
  // Открыть личный чат с участником (создаётся при необходимости).
  onOpenChat: (chatId: string) => void
}) {
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const isGroup = !isPrivate
  const [muteMenuOpen, setMuteMenuOpen] = useState(false)
  // Режим выбирается до срока: галочка применяется к любому выбранному сроку заглушения.
  const [importantOnly, setImportantOnly] = useState(false)
  // Фото и название правятся в отдельном окне (EditGroupDialog) — как в мессенджерах.
  const [editOpen, setEditOpen] = useState(false)

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const leave = useMutation({
    mutationFn: () => removeChatMemberRequest(chat.id, myId as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      onLeft()
    },
    onError: err,
  })

  const subtitle = isPrivate
    ? peerOnline
      ? t('online')
      : t('offlineStatus')
    : t('participants', { count: chat.memberCount })
  // Аватар группы меняет владелец, название — любой админ. Окно редактирования
  // открывается по любому из двух прав, внутри доступное разграничено.
  const canEdit = isGroup && (chat.isAdmin || chat.isOwner)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {variant === 'column' && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-3">
          <button
            type="button"
            aria-label={t('cancel')}
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
          >
            <X className="size-5" aria-hidden />
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{t('details')}</span>
        </div>
      )}

      <div className="flex shrink-0 flex-col items-center gap-2 border-b border-border p-5">
        <Avatar className="size-20">
          {chat.avatarUrl && <AvatarImage src={chat.avatarUrl} alt={title} />}
          <AvatarFallback className={cn('text-2xl font-medium text-white', identityColor(chat.id))}>
            {identityInitials(title)}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 max-w-full items-center gap-1.5">
          <p className="min-w-0 truncate text-lg font-semibold">{title}</p>
          {canEdit && (
            <button
              type="button"
              aria-label={t('editGroup')}
              onClick={() => setEditOpen(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>

        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {chat.muted ? (
            <Button variant="outline" size="sm" onClick={onUnmute}>
              <Bell className="size-3.5" aria-hidden />
              {chat.mutedImportantOnly ? t('unmuteImportantOnly') : t('unmute')}
            </Button>
          ) : (
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setMuteMenuOpen((v) => !v)}>
                <BellOff className="size-3.5" aria-hidden />
                {t('mute')}
              </Button>
              {muteMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMuteMenuOpen(false)} />
                  <div className="absolute left-1/2 top-full z-50 mt-1 w-52 -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
                    {/* §17: «только важные» — не отдельный срок, а модификатор к выбранному:
                        чат заглушён, но ответы мне и упоминания меня всё равно уведомляют. */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={importantOnly}
                      onClick={() => setImportantOnly((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          importantOnly
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
                        )}
                        aria-hidden
                      >
                        {importantOnly && <Check className="size-3" />}
                      </span>
                      {t('muteImportantOnly')}
                    </button>
                    <div className="my-1 h-px bg-border" aria-hidden />
                    {MUTE_DURATIONS.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => {
                          setMuteMenuOpen(false)
                          onMute(d.mode, importantOnly)
                        }}
                        className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        {t(d.key)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {isGroup ? (
            <Button
              variant="outline"
              size="sm"
              loading={leave.isPending}
              onClick={() => leave.mutate()}
            >
              <LogOut className="size-3.5" aria-hidden />
              {t('leave')}
            </Button>
          ) : (
            onOpenPeerProfile && (
              <Button variant="outline" size="sm" onClick={onOpenPeerProfile}>
                <UserRound className="size-3.5" aria-hidden />
                {t('openProfile')}
              </Button>
            )
          )}
        </div>
      </div>

      <Tabs
        defaultValue={isGroup ? 'participants' : 'media'}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 grid shrink-0 grid-flow-col justify-stretch">
          {isGroup && (
            <TabsTrigger value="participants" aria-label={t('tabParticipants')}>
              <Users className="size-4" aria-hidden />
            </TabsTrigger>
          )}
          <TabsTrigger value="media" aria-label={t('tabMedia')}>
            <ImageIcon className="size-4" aria-hidden />
          </TabsTrigger>
          <TabsTrigger value="files" aria-label={t('tabFiles')}>
            <FileText className="size-4" aria-hidden />
          </TabsTrigger>
          <TabsTrigger value="links" aria-label={t('tabLinks')}>
            <Link2 className="size-4" aria-hidden />
          </TabsTrigger>
          <TabsTrigger value="voice" aria-label={t('tabVoice')}>
            <Mic className="size-4" aria-hidden />
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isGroup && (
            <TabsContent value="participants" className={TAB_PANE}>
              <ParticipantsTab chat={chat} myId={myId} onOpenChat={onOpenChat} />
            </TabsContent>
          )}
          <TabsContent value="media" className={TAB_PANE}>
            <MediaTab chatId={chat.id} />
          </TabsContent>
          <TabsContent value="files" className={TAB_PANE}>
            <FileTab chatId={chat.id} voice={false} onJump={onJump} />
          </TabsContent>
          <TabsContent value="links" className={TAB_PANE}>
            <LinksTab chatId={chat.id} onJump={onJump} />
          </TabsContent>
          <TabsContent value="voice" className={TAB_PANE}>
            <FileTab chatId={chat.id} voice onJump={onJump} />
          </TabsContent>
        </div>
      </Tabs>

      {editOpen && <EditGroupDialog chat={chat} title={title} onClose={() => setEditOpen(false)} />}
    </div>
  )
}
