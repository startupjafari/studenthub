'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, UserRoundX, Users, X } from 'lucide-react'
import { Button, Card, CardContent, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  FriendCard,
  friendKeys,
  fetchFriends,
  fetchFriendRequests,
  acceptFriendRequest,
  removeFriendship,
  type RequestDirection,
} from '../../../entities/friendship'

type Tab = 'friends' | 'incoming' | 'outgoing'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function FriendsView() {
  const t = useTranslations('Friends')
  const [tab, setTab] = useState<Tab>('friends')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'friends', label: t('tabFriends') },
    { id: 'incoming', label: t('tabIncoming') },
    { id: 'outgoing', label: t('tabOutgoing') },
  ]

  return (
    <div className="flex w-full flex-col gap-5">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-2">
        {tabs.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setTab(it.id)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              tab === it.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {it.label}
          </button>
        ))}
      </div>

      {tab === 'friends' ? <FriendsList /> : <RequestsList direction={tab} />}
    </div>
  )
}

function FriendsList() {
  const t = useTranslations('Friends')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: friendKeys.list(), queryFn: fetchFriends })

  const removeMut = useMutation({
    mutationFn: removeFriendship,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: friendKeys.all })
      toast.success(t('removed'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  if (q.isLoading) return <ListSkeleton />
  if (q.isError) return <p className="text-destructive">{tErr(errCode(q.error))}</p>
  if (!q.data?.length) return <Empty text={t('emptyFriends')} />

  return (
    <div className="flex flex-col gap-2">
      {q.data.map((f) => (
        <FriendCard
          key={f.friendshipId}
          user={f.user}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={removeMut.isPending && removeMut.variables === f.friendshipId}
              onClick={() => removeMut.mutate(f.friendshipId)}
            >
              {t('remove')}
            </Button>
          }
        />
      ))}
    </div>
  )
}

function RequestsList({ direction }: { direction: Exclude<Tab, 'friends'> }) {
  const t = useTranslations('Friends')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const dir: RequestDirection = direction === 'incoming' ? 'incoming' : 'outgoing'
  const q = useQuery({
    queryKey: friendKeys.requests(dir),
    queryFn: () => fetchFriendRequests(dir),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: friendKeys.all })

  const acceptMut = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      void invalidate()
      toast.success(t('accepted'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })
  const removeMut = useMutation({
    mutationFn: removeFriendship,
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  if (q.isLoading) return <ListSkeleton />
  if (q.isError) return <p className="text-destructive">{tErr(errCode(q.error))}</p>
  if (!q.data?.length) {
    return <Empty text={dir === 'incoming' ? t('emptyIncoming') : t('emptyOutgoing')} />
  }

  return (
    <div className="flex flex-col gap-2">
      {q.data.map((r) => (
        <FriendCard
          key={r.friendshipId}
          user={r.user}
          action={
            dir === 'incoming' ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  loading={acceptMut.isPending && acceptMut.variables === r.friendshipId}
                  onClick={() => acceptMut.mutate(r.friendshipId)}
                >
                  <Check className="size-4" aria-hidden />
                  {t('accept')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={removeMut.isPending && removeMut.variables === r.friendshipId}
                  onClick={() => removeMut.mutate(r.friendshipId)}
                >
                  <X className="size-4" aria-hidden />
                  {t('decline')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={removeMut.isPending && removeMut.variables === r.friendshipId}
                onClick={() => removeMut.mutate(r.friendshipId)}
              >
                {t('cancel')}
              </Button>
            )
          }
        />
      ))}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Card>
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <UserRoundX className="size-7" aria-hidden />
        </span>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  )
}

// Иконка для будущего использования в навигации/заголовке.
export { Users as FriendsIcon }
