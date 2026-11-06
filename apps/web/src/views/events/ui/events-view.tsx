'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { CalendarClock, Check, MapPin, Plus, Trash2, Users, Video } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import {
  cancelEventRequest,
  deleteEventRequest,
  eventKeys,
  fetchEventsPage,
  registerEventRequest,
  type EventItem,
  MEETING_PROVIDER_NAME,
} from '../../../entities/event'
import { ProfileLink } from '../../../entities/user'
import { CreateEventModal } from '../../../features/create-event'
import { JoinMeetingButton } from '../../../features/join-meeting'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Запасной расчёт права удалять — для ответа без серверного `canManage` (E-F16): роль не
// знает scope, и декан видел бы корзину у событий всего вуза.
const MANAGER_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN]
// Модераторы события не создают — только читают ленту.
const READONLY_ROLES: Role[] = [Role.PLATFORM_MODERATOR, Role.UNIVERSITY_MODERATOR]
const FILTERS = ['upcoming', 'past'] as const
type Filter = (typeof FILTERS)[number]

export function EventsView() {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [createOpen, setCreateOpen] = useState(false)
  const role = useAppSelector((s) => s.auth.role)
  const canCreate = role !== null && !READONLY_ROLES.includes(role)

  // Страницами по 50: раньше экран брал одну страницу, и всё после пятидесятого события
  // пропадало без признака, что список неполный.
  const events = useInfiniteQuery({
    queryKey: eventKeys.pages(filter),
    queryFn: ({ pageParam }) => fetchEventsPage({ filter, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((sum, page) => sum + page.items.length, 0)
      return last.items.length > 0 && loaded < last.total ? all.length + 1 : undefined
    },
  })
  const items = events.data?.pages.flatMap((page) => page.items) ?? []

  return (
    // Без `min-h-0` (§4): сетка карточек длиннее экрана, и с ним корень сжимался до
    // высоты `main` — хвост списка уходил за его нижний отступ, последняя карточка
    // упиралась в край окна. Собственной прокрутки внутри тут нет: `overflow-hidden`
    // в файле — это скругление карточки события, а не скролл-контейнер.
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        // Разделы и создание — в шапке. Форма создания занимала первый экран целиком,
        // хотя события читают куда чаще, чем создают.
        tabs={
          <SegmentedTabs
            aria-label={t('title')}
            value={filter}
            onChange={setFilter}
            items={FILTERS.map((f) => ({ value: f, label: t(f) }))}
          />
        }
        actions={
          canCreate ? (
            <Button type="button" size="md" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('createEvent')}
            </Button>
          ) : null
        }
      />

      {events.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : events.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" aria-hidden />}
          title={t('empty')}
          description={filter === 'upcoming' ? t('emptyUpcoming') : t('emptyPast')}
          action={
            canCreate && filter === 'upcoming' ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {t('createEvent')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        // Плитками, а не списком во всю ширину: у события мало текста, и растянутая
        // на весь экран строка оставляла справа пустоту в пол-экрана.
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              past={filter === 'past'}
              managerRole={role !== null && MANAGER_ROLES.includes(role)}
            />
          ))}
        </div>
      )}
      {events.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          className="self-center"
          loading={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {t('showMore')}
        </Button>
      )}

      {createOpen && <CreateEventModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

function EventCard({
  event,
  past,
  managerRole,
}: {
  event: EventItem
  past: boolean
  managerRole: boolean
}) {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const fmt = useFormatter()
  const locale = useLocale()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)
  const isOrganizer = event.organizerId === myId
  // Право решает сервер (тем же правилом, что проверяет удаление); роль — только запасной вариант.
  const canManage = event.canManage ?? (isOrganizer || managerRole)

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

  const start = new Date(event.startsAt)
  const time = fmt.dateTime(start, { hour: '2-digit', minute: '2-digit' })
  const weekday = fmt.dateTime(start, { weekday: 'short' })

  return (
    <Card
      className={cn(
        'group/event relative gap-0 overflow-hidden py-0 transition-shadow hover:ring-ring/50',
        // Прошедшее приглушено целиком: это архив, действий по нему нет.
        past && 'opacity-70',
      )}
    >
      {/* Полоса-акцент сверху: у зарегистрированного события она зелёная — состояние
          видно, не вчитываясь в кнопку внизу карточки. */}
      <span
        aria-hidden
        className={cn('block h-1 w-full', event.isRegistered ? 'bg-success' : 'bg-primary')}
      />

      <div className="flex items-start gap-3 p-4">
        {/* Отрывной календарь: дата — первое, что ищут глазами в списке событий. */}
        <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-primary/10 py-2 text-primary">
          <span className="text-[0.65rem] font-medium uppercase">{weekday}</span>
          <span className="text-xl leading-tight font-bold tabular-nums">
            {start.toLocaleDateString(locale, { day: 'numeric' })}
          </span>
          <span className="text-[0.65rem] font-medium">
            {start.toLocaleDateString(locale, { month: 'short' })}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            {/* Название ведёт в карточку события: там описание целиком, участники и
                обсуждение. */}
            <h3 className="min-w-0 flex-1 text-sm leading-snug font-semibold">
              <Link
                href={`/events/${event.id}`}
                className="hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {event.title}
              </Link>
            </h3>
            {canManage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon
                aria-label={t('delete')}
                loading={deleteMut.isPending}
                onClick={() => {
                  void confirm({ title: t('deleteConfirm'), destructive: true }).then((ok) => {
                    if (ok) deleteMut.mutate()
                  })
                }}
                // Появляется по наведению и по фокусу: постоянная корзина в углу
                // каждой карточки — самый заметный элемент сетки, а нужен он редко.
                className="-mt-1 -mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within/event:opacity-100 group-hover/event:opacity-100 hover:text-destructive focus-visible:opacity-100"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            <ProfileLink userId={event.organizerId} className="hover:text-primary hover:underline">
              {event.organizer.lastName} {event.organizer.firstName}
            </ProfileLink>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{t(`audience${event.audience}`)}</Badge>
            {event.isRegistered && (
              <Badge variant="success" className="gap-1">
                <Check className="size-3" aria-hidden />
                {t('registered')}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {event.description && (
        <p className="line-clamp-3 px-4 text-sm text-muted-foreground">{event.description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          {time}
        </span>
        {event.isOnline ? (
          <span className="flex items-center gap-1.5 text-info">
            <Video className="size-3.5 shrink-0" aria-hidden />
            {/* Назван сервис, если он известен: «Zoom» говорит больше, чем «онлайн». */}
            {event.meetingProvider
              ? (MEETING_PROVIDER_NAME[event.meetingProvider] ?? t('meetingOther'))
              : t('online')}
          </span>
        ) : (
          event.location && (
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{event.location}</span>
            </span>
          )
        )}
        <span className="flex items-center gap-1.5">
          <Users className="size-3.5 shrink-0" aria-hidden />
          {event._count.participants}
        </span>
      </div>

      {/* Подвал прижат к низу: в сетке карточки разной высоты, и кнопки должны
          стоять на одной линии. */}
      <div className="mt-auto p-4 pt-3">
        {past ? (
          <p className="text-xs text-muted-foreground">{t('finished')}</p>
        ) : (
          // Подпись кнопки — действие, а не состояние: «Вы участвуете» на кнопке
          // читается как результат нажатия. Состояние показывает бейдж выше и
          // зелёная полоса сверху карточки.
          <div className="flex gap-2">
            <Button
              type="button"
              variant={event.isRegistered ? 'outline' : 'default'}
              size="sm"
              className="flex-1"
              loading={registerMut.isPending}
              onClick={() => registerMut.mutate()}
            >
              {event.isRegistered ? t('cancelRegistration') : t('register')}
            </Button>
            {/* Кнопка встречи — зарегистрированным и организатору: остальным сервер ссылку
                не отдаст, и показывать кнопку, которая ответит 403, незачем. */}
            {(event.isRegistered || isOrganizer) && event.meetingProvider && (
              <JoinMeetingButton
                eventId={event.id}
                provider={event.meetingProvider}
                className="flex-1"
              />
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
