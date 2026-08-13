'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, FileText, Inbox, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  appointmentKeys,
  fetchMyAppointments,
  cancelAppointmentRequest,
  type Appointment,
} from '../../../entities/appointment'
import { APPT_STATUS_BADGE, APPT_STATUS_KEY, typeKey } from '../lib/visuals'
import { CreateAppointmentModal } from './create-appointment-modal'

// «Запись в деканат» студента (задача 16): создание записи + мои записи.
export function StudentAppointmentsView() {
  const t = useTranslations('Appointments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)

  const q = useQuery({ queryKey: appointmentKeys.mine(), queryFn: () => fetchMyAppointments() })

  const cancel = useMutation({
    mutationFn: (id: string) => cancelAppointmentRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: appointmentKeys.mine() })
      toast.success(t('cancelled'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newAppointment')}
          </Button>
        }
      />

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
        <EmptyState icon={<CalendarClock />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((a) => (
            <li key={a.id}>
              <AppointmentCard
                appointment={a}
                locale={locale}
                onCancel={() => cancel.mutate(a.id)}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateAppointmentModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function AppointmentCard({
  appointment: a,
  locale,
  onCancel,
  t,
}: {
  appointment: Appointment
  locale: string
  onCancel: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const when = a.scheduledAt ?? a.requestedAt
  const active = a.status !== 'COMPLETED' && a.status !== 'CANCELLED'
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t(typeKey(a.type))}</h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden />
              {a.scheduledAt ? t('scheduledFor') : t('requestedFor')}{' '}
              {new Date(when).toLocaleString(locale, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <Badge variant={APPT_STATUS_BADGE[a.status]}>{t(APPT_STATUS_KEY[a.status])}</Badge>
        </div>
        {a.topic && <p className="text-sm text-muted-foreground">{a.topic}</p>}
        {a.staffNote && <p className="rounded-lg bg-muted/50 p-2 text-sm">{a.staffNote}</p>}
        <div className="flex items-center justify-between gap-2">
          {a.applicationId ? (
            <Button asChild variant="link" size="sm" className="h-auto gap-1 px-0">
              <Link href="/applications">
                <FileText className="size-3.5" aria-hidden />
                {t('linkedApplication')}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {active && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('cancel')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
