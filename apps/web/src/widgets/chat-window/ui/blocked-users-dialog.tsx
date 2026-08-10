'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ShieldOff, UserX, X } from 'lucide-react'
import { chatKeys, fetchBlockedUsers, unblockUserRequest } from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, AvatarImage, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useBodyScrollLock } from '../../../shared/lib'

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

// Экран «Заблокированные»: список заблокированных мной пользователей + разблокировка.
export function BlockedUsersDialog({ onClose }: { onClose: () => void }) {
  useBodyScrollLock()
  const t = useTranslations('Chats')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()

  const blocked = useQuery({ queryKey: chatKeys.blocked(), queryFn: fetchBlockedUsers })
  const list = blocked.data ?? []

  const unblock = useMutation({
    mutationFn: (userId: string) => unblockUserRequest(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.blocked() })
      void qc.invalidateQueries({ queryKey: chatKeys.list() })
      toast.success(t('userUnblocked'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 duration-150 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg duration-150 animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">{t('blockedTitle')}</span>
          <button
            type="button"
            aria-label={t('cancel')}
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {blocked.isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={<UserX className="size-6" aria-hidden />}
              title={t('blockedEmpty')}
              className="min-h-[160px]"
            />
          ) : (
            list.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <ProfileLink userId={u.id} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar className="size-9 shrink-0">
                    {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt={u.firstName} />}
                    <AvatarFallback className={cn('text-xs font-medium text-white', colorOf(u.id))}>
                      {`${u.lastName[0] ?? ''}${u.firstName[0] ?? ''}`.toUpperCase() || '#'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm font-medium">
                    {u.lastName} {u.firstName}
                  </span>
                </ProfileLink>
                <button
                  type="button"
                  onClick={() => unblock.mutate(u.id)}
                  disabled={unblock.isPending}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                >
                  <ShieldOff className="size-4" aria-hidden />
                  {t('unblockUser')}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
