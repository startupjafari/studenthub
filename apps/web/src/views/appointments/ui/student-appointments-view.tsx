'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, FileText, Inbox, Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  appointmentKeys,
  fetchMyAppointments,
  cancelAppointmentRequest,
  type Appointment,
} from '../../../entities/appointment'
import { APPT_STATUS_BADGE, APPT_STATUS_KEY, apptTypeKey } from '../lib/visuals'
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
    <div className="flex w-full flex-1 flex-col gap-4">
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-44 w-full rounded-xl" />
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
        // Плитками, как события и портфолио: у записи мало текста, и строка во всю
        // ширину монитора оставляла справа пустоту в пол-экрана.
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(q.data ?? []).map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              locale={locale}
              onCancel={() => cancel.mutate(a.id)}
              t={t}
            />
          ))}
        </div>
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
  const when = new Date(a.scheduledAt ?? a.requestedAt)
  const active = a.status !== 'COMPLETED' && a.status !== 'CANCELLED'
  // У отменённой и завершённой записи действий нет, подвала тоже — тогда нижний отступ
  // карточке нужен свой, иначе тема упирается прямо в её край.
  const hasFooter = Boolean(a.applicationId || active)

  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden py-0 transition-shadow hover:ring-ring/50',
        !hasFooter && 'pb-4',
        // Завершённая и отменённая запись приглушена целиком: это архив, действий нет.
        !active && 'opacity-70',
      )}
    >
      {/* Полоса-акцент сверху, как у карточки события: подтверждённая запись зелёная,
          отменённая красная — состояние видно, не вчитываясь в бейдж. */}
      <span
        aria-hidden
        className={cn(
          'block h-1 w-full',
          a.status === 'CANCELLED'
            ? 'bg-destructive'
            : a.status === 'CONFIRMED'
              ? 'bg-success'
              : a.status === 'COMPLETED'
                ? 'bg-muted-foreground/30'
                : 'bg-primary',
        )}
      />

      <div className="flex items-start gap-3 p-4">
        {/* Отрывной календарь: дата приёма — первое, что ищут глазами в списке записей. */}
        <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-primary/10 py-2 text-primary">
          <span className="text-[0.65rem] font-medium uppercase">
            {when.toLocaleDateString(locale, { weekday: 'short' })}
          </span>
          <span className="text-xl leading-tight font-bold tabular-nums">
            {when.toLocaleDateString(locale, { day: 'numeric' })}
          </span>
          <span className="text-[0.65rem] font-medium">
            {when.toLocaleDateString(locale, { month: 'short' })}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-sm leading-snug font-semibold">
              {t(apptTypeKey(a.type))}
            </h3>
            <Badge variant={APPT_STATUS_BADGE[a.status]} className="shrink-0">
              {t(APPT_STATUS_KEY[a.status])}
            </Badge>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {a.scheduledAt ? t('scheduledFor') : t('requestedFor')}{' '}
            {when.toLocaleString(locale, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {(a.topic || a.staffNote) && (
        <div className="flex flex-col gap-2 px-4">
          {a.topic && <p className="line-clamp-3 text-sm text-muted-foreground">{a.topic}</p>}
          {a.staffNote && <p className="rounded-lg bg-muted/50 p-2 text-sm">{a.staffNote}</p>}
        </div>
      )}

      {/* Подвал прижат к низу: в сетке карточки разной высоты, и кнопки должны стоять
          на одной линии. */}
      {hasFooter && (
        <div className="mt-auto flex flex-col gap-2 p-4 pt-3">
          {a.applicationId && (
            <Button asChild variant="link" size="sm" className="h-auto gap-1 px-0">
              <Link href="/applications">
                <FileText className="size-3.5" aria-hidden />
                {t('linkedApplication')}
              </Link>
            </Button>
          )}
          {active && (
            <Button variant="outline" size="sm" className="w-full" onClick={onCancel}>
              {t('cancel')}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
