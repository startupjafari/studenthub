'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Ban,
  Bell,
  BellOff,
  Camera,
  Check,
  Crown,
  Link2,
  LogOut,
  Pencil,
  Shield,
  ShieldOff,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react'
import {
  chatKeys,
  fetchChatMembers,
  addChatMemberRequest,
  removeChatMemberRequest,
  banChatMemberRequest,
  unbanChatMemberRequest,
  setChatAvatarRequest,
  removeChatAvatarRequest,
  editChatTitleRequest,
  setChatAdminRequest,
  transferOwnershipRequest,
} from '../../../entities/chat'
import { ProfileLink, UserPicker } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, Button, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
]
function colorOf(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length] ?? 'bg-sky-500'
}
function initials(a: string, b: string): string {
  return `${a[0] ?? ''}${b[0] ?? ''}`.toUpperCase() || '#'
}

// Модальное окно управления группой (Ф9+): аватар/название, звук, покинуть, список участников
// с ролью и онлайн-статусом, добавление участника; для создателя — смена аватара и бан участников.
export function GroupInfoDialog({
  chatId,
  title,
  avatarUrl,
  isOwner,
  isAdmin,
  muted,
  myId,
  onClose,
  onToggleMute,
  onLeft,
}: {
  chatId: string
  title: string
  avatarUrl: string | null
  isOwner: boolean
  isAdmin: boolean
  muted: boolean
  myId: string | undefined
  onClose: () => void
  onToggleMute: () => void
  onLeft: () => void
}) {
  const t = useTranslations('Chats')
  const tr = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const fileRef = useRef<HTMLInputElement>(null)

  const members = useQuery({
    queryKey: chatKeys.members(chatId),
    queryFn: () => fetchChatMembers(chatId),
  })
  const list = members.data ?? []

  const err = (e: unknown) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  const invalidateMembers = () => {
    void qc.invalidateQueries({ queryKey: chatKeys.members(chatId) })
    void qc.invalidateQueries({ queryKey: chatKeys.list() })
  }

  const addMember = useMutation({
    mutationFn: (userId: string) => addChatMemberRequest(chatId, userId),
    onSuccess: () => {
      invalidateMembers()
      setAdding(false)
      toast.success(t('memberAdded'))
    },
    onError: err,
  })

  const leave = useMutation({
    mutationFn: () => removeChatMemberRequest(chatId, myId as string),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      onLeft()
    },
    onError: err,
  })

  const ban = useMutation({
    mutationFn: ({ userId, banned }: { userId: string; banned: boolean }) =>
      banned ? unbanChatMemberRequest(chatId, userId) : banChatMemberRequest(chatId, userId),
    onSuccess: (_d, { banned }) => {
      invalidateMembers()
      toast.success(banned ? t('memberUnbanned') : t('memberBanned'))
    },
    onError: err,
  })

  const avatarMut = useMutation({
    mutationFn: (file: File) => setChatAvatarRequest(chatId, file),
    onSuccess: () => {
      invalidateMembers()
      toast.success(t('avatarUpdated'))
    },
    onError: err,
  })

  const removeAvatar = useMutation({
    mutationFn: () => removeChatAvatarRequest(chatId),
    onSuccess: () => {
      invalidateMembers()
      toast.success(t('avatarRemoved'))
    },
    onError: err,
  })

  const rename = useMutation({
    mutationFn: (name: string) => editChatTitleRequest(chatId, name),
    onSuccess: () => {
      invalidateMembers()
      setEditingTitle(false)
      toast.success(t('titleUpdated'))
    },
    onError: err,
  })

  const admin = useMutation({
    mutationFn: ({ userId, makeAdmin }: { userId: string; makeAdmin: boolean }) =>
      setChatAdminRequest(chatId, userId, makeAdmin),
    onSuccess: (_d, { makeAdmin }) => {
      invalidateMembers()
      toast.success(makeAdmin ? t('adminGranted') : t('adminRevoked'))
    },
    onError: err,
  })

  const transfer = useMutation({
    mutationFn: (userId: string) => transferOwnershipRequest(chatId, userId),
    onSuccess: () => {
      invalidateMembers()
      toast.success(t('ownershipTransferred'))
    },
    onError: err,
  })

  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) avatarMut.mutate(file)
    e.target.value = ''
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 duration-150 animate-in fade-in md:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden border-border bg-background shadow-lg duration-150 animate-in slide-in-from-bottom-4 md:h-auto md:max-h-[85vh] md:max-w-sm md:rounded-2xl md:border md:slide-in-from-bottom-0 md:zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка */}
        <div className="relative flex flex-col items-center gap-2 border-b border-border p-5 pt-[calc(1.25rem+env(safe-area-inset-top))] md:pt-5">
          <button
            type="button"
            aria-label={t('cancel')}
            onClick={onClose}
            className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
          <div className="relative">
            <Avatar className="size-20">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={title} />}
              <AvatarFallback className={cn('text-2xl font-medium text-white', colorOf(chatId))}>
                {title
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? '')
                  .join('') || '#'}
              </AvatarFallback>
            </Avatar>
            {isOwner && (
              <>
                <button
                  type="button"
                  aria-label={t('changeAvatar')}
                  onClick={() => fileRef.current?.click()}
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity hover:opacity-100"
                >
                  <Camera className="size-6" aria-hidden />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickAvatar}
                />
              </>
            )}
          </div>
          {editingTitle ? (
            <div className="flex w-full items-center gap-1.5">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                autoFocus
                maxLength={150}
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
              />
              <button
                type="button"
                aria-label={t('save')}
                disabled={rename.isPending || !titleDraft.trim()}
                onClick={() => rename.mutate(titleDraft.trim())}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              >
                <Check className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('cancel')}
                onClick={() => {
                  setEditingTitle(false)
                  setTitleDraft(title)
                }}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-center text-lg font-semibold">{title}</span>
              {isAdmin && (
                <button
                  type="button"
                  aria-label={t('editTitle')}
                  onClick={() => {
                    setTitleDraft(title)
                    setEditingTitle(true)
                  }}
                  className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
          )}
          <span className="text-sm text-muted-foreground">
            {t('participants', { count: list.length })}
          </span>

          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onToggleMute}>
              {muted ? (
                <BellOff className="size-4" aria-hidden />
              ) : (
                <Bell className="size-4" aria-hidden />
              )}
              {muted ? t('unmute') : t('mute')}
            </Button>
            {isOwner && avatarUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={removeAvatar.isPending}
                onClick={() => removeAvatar.mutate()}
              >
                {t('removeAvatar')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={leave.isPending}
              onClick={() => leave.mutate()}
            >
              <LogOut className="size-4" aria-hidden />
              {t('leave')}
            </Button>
          </div>
        </div>

        {/* Участники */}
        <div className="flex items-center justify-between px-4 pb-1 pt-3">
          <span className="text-sm font-semibold">{t('participants', { count: list.length })}</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label={t('inviteLink')}
              onClick={() => {
                void navigator.clipboard?.writeText(`${window.location.origin}/join-chat/${chatId}`)
                toast.success(t('linkCopied'))
              }}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Link2 className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t('addMember')}
              onClick={() => setAdding((v) => !v)}
              className={cn(
                'flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
                adding && 'bg-muted text-foreground',
              )}
            >
              <UserPlus className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {adding && (
          <div className="px-4 pb-2 duration-150 animate-in fade-in slide-in-from-top-1">
            <UserPicker value={null} onSelect={(u) => u && addMember.mutate(u.id)} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {members.isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            list.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-2 py-2',
                  m.banned && 'opacity-60',
                )}
              >
                <ProfileLink userId={m.id} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative shrink-0">
                    <Avatar className="size-9">
                      {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt={m.firstName} />}
                      <AvatarFallback
                        className={cn('text-xs font-medium text-white', colorOf(m.id))}
                      >
                        {initials(m.lastName, m.firstName)}
                      </AvatarFallback>
                    </Avatar>
                    {m.online && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-green-500"
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {m.lastName} {m.firstName}
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
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {m.online ? t('online') : t('offlineStatus')}
                    </span>
                  </div>
                </ProfileLink>
                <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground sm:block">
                  {tr(m.role)}
                </span>
                {/* Владелец: передать владение + назначить/снять админа */}
                {isOwner && m.id !== myId && !m.banned && (
                  <>
                    <button
                      type="button"
                      aria-label={t('transferOwnership')}
                      title={t('transferOwnership')}
                      onClick={() => {
                        if (window.confirm(t('transferConfirm', { name: m.firstName })))
                          transfer.mutate(m.id)
                      }}
                      disabled={transfer.isPending}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
                    >
                      <Crown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={m.isAdmin ? t('revokeAdmin') : t('grantAdmin')}
                      title={m.isAdmin ? t('revokeAdmin') : t('grantAdmin')}
                      onClick={() => admin.mutate({ userId: m.id, makeAdmin: !m.isAdmin })}
                      disabled={admin.isPending}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {m.isAdmin ? (
                        <ShieldOff className="size-4" aria-hidden />
                      ) : (
                        <Shield className="size-4" aria-hidden />
                      )}
                    </button>
                  </>
                )}
                {/* Любой админ: бан/разбан (нельзя банить админов/владельца) */}
                {isAdmin && m.id !== myId && (!m.isAdmin || m.banned) && (
                  <button
                    type="button"
                    aria-label={m.banned ? t('unban') : t('ban')}
                    title={m.banned ? t('unban') : t('ban')}
                    onClick={() => ban.mutate({ userId: m.id, banned: m.banned })}
                    disabled={ban.isPending}
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      m.banned
                        ? 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
                        : 'text-destructive hover:bg-destructive/10',
                    )}
                  >
                    {m.banned ? (
                      <UserCheck className="size-4" aria-hidden />
                    ) : (
                      <Ban className="size-4" aria-hidden />
                    )}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
