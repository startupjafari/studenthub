'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, MapPin, Trash2, Users, Video } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  cancelEventRequest,
  deleteEventRequest,
  eventKeys,
  fetchEvents,
  registerEventRequest,
  type EventItem,
} from '../../../entities/event'
import { ProfileLink } from '../../../entities/user'
import { CreateEventForm } from '../../../features/create-event'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const MANAGER_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN]

export function EventsView() {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')
  const role = useAppSelector((s) => s.auth.role)

  const events = useQuery({
    queryKey: eventKeys.list(filter),
    queryFn: () => fetchEvents({ filter }),
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} />

      {role !== null && role !== Role.PLATFORM_MODERATOR && role !== Role.UNIVERSITY_MODERATOR && (
        <CreateEventForm />
      )}

      <div className="inline-flex w-fit rounded-xl border border-border p-1">
        {(['upcoming', 'past'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(f)}
          </button>
        ))}
      </div>

      {events.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : events.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (events.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" aria-hidden />}
          title={t('empty')}
          description={filter === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {events.data!.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              filter={filter}
              canManage={role !== null && MANAGER_ROLES.includes(role)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({
  event,
  filter,
  canManage,
}: {
  event: EventItem
  filter: 'upcoming' | 'past'
  canManage: boolean
}) {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const locale = useLocale()
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const isOrganizer = event.organizerId === myId

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: eventKeys.all })
  }
  const onError = (e: unknown): void => {
    toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR'))
  }

  const registerMut = useMutation({
    mutationFn: () =>
      event.isRegistered ? cancelEventRequest(event.id) : registerEventRequest(event.id),
    onSuccess: invalidate,
    onError,
  })
  const deleteMut = useMutation({
    mutationFn: () => deleteEventRequest(event.id),
    onSuccess: () => {
      invalidate()
      toast.success(t('deleted'))
    },
    onError,
  })

  const start = new Date(event.startsAt).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">{event.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <ProfileLink
                userId={event.organizerId}
                className="hover:text-primary hover:underline"
              >
                {event.organizer.lastName} {event.organizer.firstName}
              </ProfileLink>{' '}
              · {t(`audience${event.audience}`)}
            </p>
          </div>
          {(isOrganizer || canManage) && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('delete')}
              loading={deleteMut.isPending}
              onClick={() => {
                void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                  if (ok) deleteMut.mutate()
                })
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>

        <p className="text-sm whitespace-pre-wrap">{event.description}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-4" aria-hidden />
            {start}
          </span>
          {event.isOnline ? (
            <span className="flex items-center gap-1.5">
              <Video className="size-4" aria-hidden />
              {t('online')}
            </span>
          ) : (
            event.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden />
                {event.location}
              </span>
            )
          )}
          <span className="flex items-center gap-1.5">
            <Users className="size-4" aria-hidden />
            {event._count.participants}
          </span>
        </div>

        {filter === 'upcoming' && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={event.isRegistered ? 'outline' : 'default'}
              size="sm"
              loading={registerMut.isPending}
              onClick={() => registerMut.mutate()}
            >
              {event.isRegistered ? t('cancelRegistration') : t('register')}
            </Button>
            {event.isRegistered && <Badge variant="secondary">{t('registered')}</Badge>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
