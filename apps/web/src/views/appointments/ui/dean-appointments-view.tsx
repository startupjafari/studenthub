'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  MoreHorizontal,
  User,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  appointmentKeys,
  fetchAppointmentQueue,
  completeAppointmentRequest,
  staffCancelAppointmentRequest,
  type Appointment,
} from '../../../entities/appointment'
import { APPT_STATUS_BADGE, APPT_STATUS_KEY, typeKey } from '../lib/visuals'
import { ConfirmAppointmentModal } from './confirm-appointment-modal'

// «Запись в деканат» деканата (задача 16): очередь записей + обработка.
export function DeanAppointmentsView() {
  const t = useTranslations('Appointments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [modal, setModal] = useState<{ id: string; mode: 'confirm' | 'reschedule' } | null>(null)

  const q = useQuery({ queryKey: appointmentKeys.queue(), queryFn: () => fetchAppointmentQueue() })

  const complete = useMutation({
    mutationFn: (id: string) => completeAppointmentRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: appointmentKeys.all })
      toast.success(t('completed'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => staffCancelAppointmentRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: appointmentKeys.all })
      toast.success(t('cancelled'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('queueTitle')} />

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={t('queueEmpty')}
          description={t('queueEmptyHint')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((a) => (
            <li key={a.id}>
              <QueueRow
                appointment={a}
                locale={locale}
                onConfirm={() => setModal({ id: a.id, mode: 'confirm' })}
                onReschedule={() => setModal({ id: a.id, mode: 'reschedule' })}
                onComplete={() => complete.mutate(a.id)}
                onCancel={() => cancel.mutate(a.id)}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <ConfirmAppointmentModal
          appointmentId={modal.id}
          mode={modal.mode}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function QueueRow({
  appointment: a,
  locale,
  onConfirm,
  onReschedule,
  onComplete,
  onCancel,
  t,
}: {
  appointment: Appointment
  locale: string
  onConfirm: () => void
  onReschedule: () => void
  onComplete: () => void
  onCancel: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const when = a.scheduledAt ?? a.requestedAt
  const active = a.status !== 'COMPLETED' && a.status !== 'CANCELLED'
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-medium">
              <User className="size-3.5 text-muted-foreground" aria-hidden />
              {a.student.firstName} {a.student.lastName}
            </span>
            <Badge variant={APPT_STATUS_BADGE[a.status]}>{t(APPT_STATUS_KEY[a.status])}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{t(typeKey(a.type))}</span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden />
              {new Date(when).toLocaleString(locale, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          {a.topic && <p className="mt-1 text-sm text-muted-foreground">{a.topic}</p>}
        </div>
        {active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('actions')}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onConfirm}>
                <CheckCircle2 aria-hidden />
                {t('confirm')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onReschedule}>
                <Clock aria-hidden />
                {t('reschedule')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onComplete}>
                <CheckCircle2 aria-hidden />
                {t('complete')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onCancel}>
                <XCircle aria-hidden />
                {t('cancelAppointment')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardContent>
    </Card>
  )
}
