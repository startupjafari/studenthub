'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Lock, UserRoundX } from 'lucide-react'
import { Button, Card, CardContent, Skeleton } from '../../../shared/ui'
import { fetchUserById, fetchUserPresence, userKeys } from '../../../entities/user'
import { useRealtimeEvent } from '../../../shared/realtime'
import {
  ENTER,
  ProfileBody,
  ProfileIdentity,
  StatusDot,
  fullNameOf,
  initialsOf,
} from './profile-content'
import { ProfileTabs, type ProfileTabId } from './profile-tabs'
import { ShareProfileButton } from './share-profile-button'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

export function PublicUserProfile({ userId }: { userId: string }) {
  const t = useTranslations('Profile')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')
  const router = useRouter()

  const q = useQuery({
    queryKey: userKeys.detail(userId),
    queryFn: () => fetchUserById(userId),
    retry: false,
  })

  // Присутствие: снапшот через REST + живые апдейты по WS (событие глобальное).
  const presenceQ = useQuery({
    queryKey: userKeys.presence(userId),
    queryFn: () => fetchUserPresence(userId),
  })
  const [online, setOnline] = useState(false)
  const [tab, setTab] = useState<ProfileTabId>('profile')
  useEffect(() => {
    if (presenceQ.data) setOnline(presenceQ.data.online)
  }, [presenceQ.data])
  useRealtimeEvent<{ userId: string; online: boolean }>('presence:changed', (p) => {
    if (p.userId === userId) setOnline(p.online)
  })

  if (q.isLoading) return <PublicSkeleton />

  if (q.isError || !q.data) {
    const notFound = q.error && errCode(q.error) === 'NOT_FOUND'
    return (
      <div className="w-full">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <UserRoundX className="size-7" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">
              {notFound ? t('userNotFound') : tErr(errCode(q.error))}
            </p>
            <Button variant="outline" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="size-4" aria-hidden />
              {tCommon('goBack')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const u = q.data

  return (
    <div className="flex w-full flex-col gap-5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="w-fit self-start text-muted-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {tCommon('goBack')}
      </Button>

      <Card className={`overflow-hidden p-0 ${ENTER}`}>
        <div className="h-36 w-full bg-gradient-to-br from-primary via-indigo-500 to-violet-500 sm:h-44" />
        <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:gap-5 sm:px-6">
          <div className="-mt-14 shrink-0 sm:-mt-16">
            <div className="relative size-28 sm:size-32">
              {u.avatarUrl ? (
                <Image
                  src={u.avatarUrl}
                  alt={fullNameOf(u)}
                  width={128}
                  height={128}
                  unoptimized
                  className="size-full rounded-full border-4 border-background object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center rounded-full border-4 border-background bg-primary text-3xl font-semibold text-primary-foreground">
                  {initialsOf(u) || '#'}
                </div>
              )}
              <span className="absolute left-[85%] top-[15%] z-10 -translate-x-1/2 -translate-y-1/2">
                <StatusDot online={online} />
              </span>
            </div>
          </div>
          <ProfileIdentity data={u} />
          <div className="flex shrink-0 self-start sm:self-end">
            <ShareProfileButton userId={u.id} name={fullNameOf(u)} />
          </div>
        </div>
      </Card>

      {u.access === 'limited' ? (
        <Card className={ENTER}>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Lock className="size-7" aria-hidden />
            </span>
            <p className="text-base font-semibold">{t('profileClosed')}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t('profileClosedDesc')}</p>
          </CardContent>
        </Card>
      ) : (
        <ProfileTabs userId={u.id} isOwner={false} tab={tab} onTabChange={setTab}>
          <ProfileBody data={u} />
        </ProfileTabs>
      )}
    </div>
  )
}

function PublicSkeleton() {
  return (
    <div className="flex w-full flex-col gap-5">
      <Card className="overflow-hidden p-0">
        <Skeleton className="h-36 w-full rounded-none sm:h-44" />
        <div className="flex items-end gap-5 px-6 pb-4">
          <Skeleton className="-mt-16 size-32 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pb-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </Card>
      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  )
}
