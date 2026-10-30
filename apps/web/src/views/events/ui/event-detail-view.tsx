'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { CalendarClock, Check, MapPin, Pencil, Send, Trash2, Users, Video } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { CreateEventCommentSchema, type CreateEventCommentInput } from '@studenthub/shared-schemas'
import {
  addEventCommentRequest,
  cancelEventRequest,
  deleteEventCommentRequest,
  eventKeys,
  fetchEvent,
  fetchEventComments,
  fetchEventParticipantsPage,
  registerEventRequest,
  MEETING_PROVIDER_NAME,
  type EventCommentsPage,
  type EventItem,
  type EventParticipantsPage,
} from '../../../entities/event'
import { ProfileLink } from '../../../entities/user'
import { EditEventModal } from '../../../features/create-event'
import { JoinMeetingButton } from '../../../features/join-meeting'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  EmptyState,
  FieldError,
  PageHeader,
  Skeleton,
  Textarea,
  useConfirm,
} from '../../../shared/ui'
import { cn, toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'

// Запасной расчёт прав по роли — только для ответа без серверных флагов `canManage` /
// `canDelete` (E-F16): роль не знает scope, и декан видел бы кнопки у чужих событий.
const MANAGER_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN]
const MODERATOR_ROLES: Role[] = [Role.PLATFORM_MODERATOR, Role.UNIVERSITY_MODERATOR]
// Событие без указанного конца длится два часа — как считает сервер.
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000

/**
 * Карточка события (docs/PROJECT.md §3.5): подробности, регистрация и вход во встречу,
 * список участников для организатора и админов, обсуждение. Сюда ведут уведомления о
 * событии — до этого они открывали общий список, и нужное событие приходилось искать.
 */
export function EventDetailView({ eventId }: { eventId: string }) {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const router = useRouter()
  const role = useAppSelector((s) => s.auth.role)
  const myId = useAppSelector((s) => s.auth.user?.id)

  const event = useQuery({
    queryKey: eventKeys.detail(eventId),
    queryFn: () => fetchEvent(eventId),
  })
  const [editing, setEditing] = useState(false)
  const isOrganizer = event.data?.organizerId === myId
  const canManage =
    event.data?.canManage ?? (isOrganizer || (role !== null && MANAGER_ROLES.includes(role)))

  return (
    // На десктопе страница ровно в высоту области контента: обсуждение и участники
    // занимают всё, что осталось под карточкой, и прокручиваются внутри себя. На узком
    // экране колонки идут друг под другом, и прокручивается сама страница.
    <div className="flex w-full flex-1 flex-col gap-4 lg:min-h-0">
      <PageHeader
        title={event.data?.title ?? t('title')}
        onBack={() => router.back()}
        backLabel={t('back')}
        actions={
          event.data && (
            <>
              <EventActions event={event.data} />
              {canManage && (
                <Button variant="outline" size="md" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden />
                  {t('edit')}
                </Button>
              )}
            </>
          )
        }
      />

      {event.isLoading ? (
        <Skeleton fill className="min-h-64 rounded-xl" />
      ) : event.isError || !event.data ? (
        <EmptyState
          icon={<CalendarClock className="size-6" aria-hidden />}
          title={tErr(toApiError(event.error).code)}
          description={t('notFoundHint')}
        />
      ) : (
        // Колонка участников — только тем, кто их видит: иначе справа пустовала бы полоса.
        <div
          className={cn(
            'grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]',
            canManage && 'lg:grid-cols-[minmax(0,1fr)_20rem]',
          )}
        >
          <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
            <EventInfo event={event.data} />
            {/* canModerate — запасной расчёт для ответа без `canDelete` у комментариев. */}
            <Comments
              eventId={eventId}
              canModerate={canManage || (role !== null && MODERATOR_ROLES.includes(role))}
            />
          </div>
          {canManage && <Participants eventId={eventId} total={event.data._count.participants} />}
        </div>
      )}

      {editing && event.data && (
        <EditEventModal event={event.data} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}

/**
 * Завершилось — по концу, а не по началу: к идущему событию ещё подключаются, и сервер
 * принимает регистрацию до его конца.
 */
function isPast(event: EventItem): boolean {
  const start = new Date(event.startsAt).getTime()
  const end = event.endsAt ? new Date(event.endsAt).getTime() : start + DEFAULT_DURATION_MS
  return end < Date.now()
}

/** Участие и вход во встречу — в шапке страницы, рядом с «Изменить». */
function EventActions({ event }: { event: EventItem }) {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const myId = useAppSelector((s) => s.auth.user?.id)

  const registerMut = useMutation({
    mutationFn: () =>
      event.isRegistered ? cancelEventRequest(event.id) : registerEventRequest(event.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: eventKeys.all }),
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  if (isPast(event)) return null
  return (
    <>
      {/* Ссылку сервер отдаёт участникам и организатору — остальным кнопку не показываем.
          Организатору регистрация не нужна: встречу ведёт он. */}
      {(event.isRegistered || event.organizerId === myId) && event.meetingProvider && (
        <JoinMeetingButton eventId={event.id} provider={event.meetingProvider} size="md" />
      )}
      <Button
        variant={event.isRegistered ? 'outline' : 'default'}
        size="md"
        loading={registerMut.isPending}
        onClick={() => registerMut.mutate()}
      >
        {event.isRegistered ? t('cancelRegistration') : t('register')}
      </Button>
    </>
  )
}

function EventInfo({ event }: { event: EventItem }) {
  const t = useTranslations('Events')
  const fmt = useFormatter()
  const start = new Date(event.startsAt)

  const when = fmt.dateTimeRange(start, event.endsAt ? new Date(event.endsAt) : start, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Card className="flex shrink-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{t(`audience${event.audience}`)}</Badge>
        {event.isRegistered && (
          <Badge variant="success" className="gap-1">
            <Check className="size-3" aria-hidden />
            {t('registered')}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <span className="flex items-center gap-2">
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {when}
        </span>
        {event.isOnline ? (
          <span className="flex items-center gap-2 text-info">
            <Video className="size-4 shrink-0" aria-hidden />
            {event.meetingProvider
              ? (MEETING_PROVIDER_NAME[event.meetingProvider] ?? t('meetingOther'))
              : t('online')}
          </span>
        ) : (
          event.location && (
            <span className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {event.location}
            </span>
          )
        )}
        <span className="flex items-center gap-2">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {t('participantsCount', { count: event._count.participants })}
        </span>
        <span className="text-muted-foreground">
          {t('organizer')}:{' '}
          <ProfileLink userId={event.organizerId} className="text-foreground hover:underline">
            {event.organizer.lastName} {event.organizer.firstName}
          </ProfileLink>
        </span>
      </div>

      {event.description && <p className="text-sm whitespace-pre-line">{event.description}</p>}

      {isPast(event) && <p className="text-sm text-muted-foreground">{t('finished')}</p>}
    </Card>
  )
}

// Участники — только организатору и админам scope: это список людей, а не публичная часть.
// Страницами по порядку регистрации: прежний ответ одним массивом обрезался на тысяче.
function Participants({ eventId, total }: { eventId: string; total: number }) {
  const t = useTranslations('Events')
  const tRoles = useTranslations('Roles')
  const participants = useInfiniteQuery({
    queryKey: eventKeys.participants(eventId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchEventParticipantsPage(eventId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: EventParticipantsPage) => (last.hasNext ? last.cursor : undefined),
    retry: false,
  })
  // 403 у админа чужого scope — не ошибка экрана: блок просто не нужен.
  if (participants.isError) return null
  const items = participants.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Card className="flex h-fit flex-col gap-3 p-4 lg:h-auto lg:min-h-0">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {t('participants')}
        {total > 0 && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{total}</span>
        )}
      </h2>
      {participants.isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noParticipants')}</p>
      ) : (
        <ul className="-mx-2 flex max-h-96 flex-col gap-0.5 overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
          {items.map((p) => {
            // Подпись — роль и где человек учится или работает: группа точнее факультета.
            const place = p.user.group?.name ?? p.user.faculty?.name
            const caption = [p.user.role ? tRoles(p.user.role) : null, place]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={p.userId}>
                <ProfileLink
                  userId={p.userId}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted"
                >
                  <Avatar className="size-8">
                    {p.user.avatarThumbUrl && <AvatarImage src={p.user.avatarThumbUrl} alt="" />}
                    <AvatarFallback className="text-xs">
                      {`${p.user.firstName[0] ?? ''}${p.user.lastName[0] ?? ''}`.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {p.user.lastName} {p.user.firstName}
                    </span>
                    {caption && (
                      <span className="truncate text-xs text-muted-foreground">{caption}</span>
                    )}
                  </span>
                </ProfileLink>
              </li>
            )
          })}
          {participants.hasNextPage && (
            <li className="px-2">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                loading={participants.isFetchingNextPage}
                onClick={() => void participants.fetchNextPage()}
              >
                {t('showMore')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}

function Comments({ eventId, canModerate }: { eventId: string; canModerate: boolean }) {
  const t = useTranslations('Events')
  const tErr = useTranslations('Errors')
  const fmt = useFormatter()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const myId = useAppSelector((s) => s.auth.user?.id)
  // Страницы — свежие сверху; «Показать предыдущие» догружает более ранние (E-F12).
  const comments = useInfiniteQuery({
    queryKey: eventKeys.comments(eventId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchEventComments(eventId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: EventCommentsPage) => (last.hasNext ? last.cursor : undefined),
  })
  const form = useForm<CreateEventCommentInput>({
    resolver: zodResolver(CreateEventCommentSchema),
  })

  // После записи — перезапрос загруженных страниц: TanStack перечитывает их по порядку
  // от первой с новыми курсорами, так что сдвиг страниц из-за нового комментария не теряет
  // и не дублирует строки.
  const add = useMutation({
    mutationFn: (values: CreateEventCommentInput) =>
      addEventCommentRequest(eventId, values.content),
    onSuccess: async () => {
      form.reset({ content: '' })
      await qc.invalidateQueries({ queryKey: eventKeys.comments(eventId) })
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const remove = useMutation({
    mutationFn: (commentId: string) => deleteEventCommentRequest(eventId, commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: eventKeys.comments(eventId) }),
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const pages = comments.data?.pages ?? []
  // На экране — по порядку написания: самые старые сверху, свежие у поля ввода.
  const items = pages.flatMap((p) => p.items).reverse()
  // Счётчик — со всего обсуждения, а не с догруженных страниц.
  const total = pages[0]?.total ?? items.length

  // Обсуждение прокручивается внутри карточки, свежее — внизу, у поля ввода. Прокручиваем
  // к нему при загрузке и при новом комментарии; догрузка ранних самый свежий не меняет —
  // и читатель остаётся там, где был.
  const listRef = useRef<HTMLDivElement>(null)
  const newestId = items.at(-1)?.id
  useEffect(() => {
    const list = listRef.current
    if (list && newestId) list.scrollTop = list.scrollHeight
  }, [newestId])

  return (
    <Card className="flex flex-col gap-3 p-4 lg:min-h-72 lg:flex-1">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {t('comments')}
        {total > 0 && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{total}</span>
        )}
      </h2>
      <div ref={listRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {comments.isLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : comments.isError ? (
          <p className="text-sm text-muted-foreground">{tErr(toApiError(comments.error).code)}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noComments')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.hasNextPage && (
              <li>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  loading={comments.isFetchingNextPage}
                  onClick={() => void comments.fetchNextPage()}
                >
                  {t('showEarlierComments')}
                </Button>
              </li>
            )}
            {items.map((c) => {
              const own = c.author.id === myId
              const canDelete = c.canDelete ?? (own || canModerate)
              return (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar className="size-8">
                    {c.author.avatarThumbUrl && (
                      <AvatarImage src={c.author.avatarThumbUrl} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {`${c.author.firstName[0] ?? ''}${c.author.lastName[0] ?? ''}`.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                      <ProfileLink
                        userId={c.author.id}
                        className="text-sm font-medium hover:underline"
                      >
                        {c.author.lastName} {c.author.firstName}
                      </ProfileLink>
                      <span className="text-xs text-muted-foreground">
                        {fmt.dateTime(new Date(c.createdAt), {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={own ? t('deleteComment') : t('deleteCommentModeration')}
                          title={own ? t('deleteComment') : t('deleteCommentModeration')}
                          loading={remove.isPending && remove.variables === c.id}
                          onClick={() => {
                            // Свой — сразу; чужой — решение модерации: с подтверждением, оно в аудите.
                            if (own) {
                              remove.mutate(c.id)
                              return
                            }
                            void confirm({
                              title: t('deleteCommentConfirm'),
                              description: t('moderationDeleteHint'),
                              confirmLabel: t('deleteCommentModeration'),
                              destructive: true,
                            }).then((ok) => {
                              if (ok) remove.mutate(c.id)
                            })
                          }}
                          className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm break-words whitespace-pre-line">{c.content}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <form
        onSubmit={form.handleSubmit((values) => add.mutate(values))}
        className="flex items-end gap-2 border-t border-border pt-3"
      >
        <div className="flex flex-1 flex-col gap-1">
          <Textarea
            rows={2}
            placeholder={t('commentPlaceholder')}
            aria-label={t('commentPlaceholder')}
            aria-invalid={!!form.formState.errors.content}
            {...form.register('content')}
          />
          <FieldError>{form.formState.errors.content ? t('commentInvalid') : null}</FieldError>
        </div>
        <Button type="submit" icon aria-label={t('sendComment')} loading={add.isPending}>
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </Card>
  )
}
