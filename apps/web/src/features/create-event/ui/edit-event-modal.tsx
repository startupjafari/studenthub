'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { UpdateEventSchema, type UpdateEventInput } from '@studenthub/shared-schemas'
import { useErrorToast } from '../../../shared/lib'
import {
  eventKeys,
  fetchEventMeeting,
  updateEventRequest,
  type EventItem,
} from '../../../entities/event'
import { Button, Modal, Skeleton } from '../../../shared/ui'
import { EventDetailsFields } from './event-details-fields'

/**
 * Текущая встреча для формы. `undefined` — неизвестно: ссылку отдают только участникам и
 * организатору, и админ без регистрации её не видит. Тогда пустое поле ссылку не трогает
 * (сервер правит встречу частично), а вписанная — заменяет.
 */
interface MeetingState {
  url: string | null | undefined
  passcode: string | null | undefined
}

/**
 * Правка события: перенос, место, ссылка на встречу, текст (E-F21). Форма — та же, что
 * у создания; на сервер уходят только изменённые поля. О переносе начала участников
 * уведомляет сервер.
 */
export function EditEventModal({ event, onClose }: { event: EventItem; onClose: () => void }) {
  const t = useTranslations('Events')
  // Ссылки в карточке нет — читаем отдельно и не держим в кэше после закрытия окна.
  const meeting = useQuery({
    queryKey: eventKeys.meeting(event.id),
    queryFn: () => fetchEventMeeting(event.id),
    enabled: event.meetingProvider !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })
  const current: MeetingState =
    event.meetingProvider === null
      ? { url: null, passcode: null }
      : meeting.data
        ? { url: meeting.data.url, passcode: meeting.data.passcode }
        : { url: undefined, passcode: undefined }

  return (
    <Modal onClose={onClose} title={t('editEvent')} size="lg">
      {meeting.isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : (
        <EditEventForm event={event} meeting={current} onClose={onClose} />
      )}
    </Modal>
  )
}

function EditEventForm({
  event,
  meeting,
  onClose,
}: {
  event: EventItem
  meeting: MeetingState
  onClose: () => void
}) {
  const t = useTranslations('Events')
  const tCommon = useTranslations('Common')
  const qc = useQueryClient()
  const { show: showApiError } = useErrorToast('edit-event')

  const form = useForm<UpdateEventInput>({
    resolver: zodResolver(UpdateEventSchema),
    defaultValues: {
      title: event.title,
      description: event.description,
      location: event.location ?? undefined,
      isOnline: event.isOnline,
      meetingUrl: meeting.url ?? undefined,
      meetingPasscode: meeting.passcode ?? undefined,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    },
  })

  const mutation = useMutation({
    mutationFn: (input: UpdateEventInput) => updateEventRequest(event.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventKeys.all })
      toast.success(t('updated'))
      onClose()
    },
    onError: (e) => showApiError(e),
  })

  const submit = (values: UpdateEventInput): void => {
    const patch = changedFields(event, meeting, values)
    // Ничего не поменяли — запрос незачем (и уведомлений участникам тоже).
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    mutation.mutate(patch)
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4">
      <EventDetailsFields
        form={form}
        mode="edit"
        meetingHint={meeting.url === undefined ? t('meetingKeepHint') : undefined}
      />
      <p className="text-xs text-muted-foreground">{t('rescheduleNotice')}</p>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {tCommon('cancel')}
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {t('saveChanges')}
        </Button>
      </div>
    </form>
  )
}

const blank = (v: string | null | undefined): string | null => v?.trim() || null

/** Только изменённые поля: PATCH частичный, и неотправленное сервер не трогает. */
function changedFields(
  event: EventItem,
  meeting: MeetingState,
  values: UpdateEventInput,
): UpdateEventInput {
  const patch: UpdateEventInput = {}
  if (values.title !== undefined && values.title !== event.title) patch.title = values.title
  if (values.description !== undefined && values.description !== event.description) {
    patch.description = values.description
  }
  if (values.startsAt && !sameMoment(values.startsAt, event.startsAt)) {
    patch.startsAt = values.startsAt
  }
  const endsAt = values.endsAt ?? null
  if (endsAt === null ? event.endsAt !== null : !sameMoment(endsAt, event.endsAt)) {
    patch.endsAt = endsAt
  }

  const online = values.isOnline === true
  if (online !== event.isOnline) patch.isOnline = online
  if (online) {
    const url = blank(values.meetingUrl)
    // Текущая ссылка неизвестна — пустое поле её не трогает, вписанная заменяет.
    if (meeting.url === undefined ? url !== null : url !== meeting.url) patch.meetingUrl = url
    const passcode = blank(values.meetingPasscode)
    if (meeting.passcode === undefined ? passcode !== null : passcode !== meeting.passcode) {
      patch.meetingPasscode = passcode
    }
  } else {
    // Событие стало очным — встреча уходит целиком (null у ссылки стирает и код).
    if (event.meetingProvider !== null) patch.meetingUrl = null
    const location = blank(values.location)
    if (location !== blank(event.location)) patch.location = location
  }
  return patch
}

function sameMoment(a: string, b: string | null): boolean {
  return b !== null && new Date(a).getTime() === new Date(b).getTime()
}
