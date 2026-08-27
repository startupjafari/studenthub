'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ShieldOff, UserX } from 'lucide-react'
import { chatKeys, fetchBlockedUsers, unblockUserRequest } from '../../../entities/chat'
import { ProfileLink } from '../../../entities/user'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  EmptyState,
  Modal,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { identityColor } from '../../../shared/lib'

// Экран «Заблокированные»: список заблокированных мной пользователей + разблокировка.
// Оболочка — системный Modal (shared/ui): единая шапка с крестиком, фокус-трап, ESC.
export function BlockedUsersDialog({ onClose }: { onClose: () => void }) {
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
    <Modal onClose={onClose} title={t('blockedTitle')} size="lg" className="h-[min(85vh,40rem)]">
      {blocked.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<UserX className="size-6" aria-hidden />} title={t('blockedEmpty')} />
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50"
            >
              <ProfileLink userId={u.id} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar className="size-10 shrink-0">
                  {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt={u.firstName} />}
                  <AvatarFallback
                    className={cn('text-xs font-medium text-white', identityColor(u.id))}
                  >
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
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
