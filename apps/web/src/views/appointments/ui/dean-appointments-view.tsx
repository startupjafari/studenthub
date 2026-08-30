'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, CheckCircle2, Clock, Inbox, MoreHorizontal, XCircle } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { cn } from '../../../shared/lib/utils'
import {
  appointmentKeys,
  fetchAppointmentQueue,
  completeAppointmentRequest,
  staffCancelAppointmentRequest,
  type Appointment,
} from '../../../entities/appointment'
import { APPT_STATUS_BADGE, APPT_STATUS_KEY, apptTypeKey } from '../lib/visuals'
import { ConfirmAppointmentModal } from './confirm-appointment-modal'

// Ширины колонок: тема тянет остаток — это единственное свободное поле в строке.
const COLS = ['22%', '15%', '15%', '28%', '14%', '3.5rem'] as const
// На узком экране остаются студент, время и статус — по ним очередь и разбирают.
const HIDE = {
  type: 'hidden md:table-cell',
  topic: 'hidden lg:table-cell',
} as const

/** Время приёма: назначенное, а пока его нет — желаемое студентом. */
function whenOf(a: Appointment): string {
  return a.scheduledAt ?? a.requestedAt
}

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

  const rows = q.data ?? []
  // По умолчанию сверху ближайший приём: очередь разбирают по времени, а не по алфавиту.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<Appointment>(
    rows,
    (a, key) => {
      if (key === 'student') return `${a.student.lastName} ${a.student.firstName}`
      if (key === 'type') return a.type
      if (key === 'when') return whenOf(a)
      if (key === 'topic') return a.topic
      if (key === 'status') return a.status
      return null
    },
    { key: 'when', dir: 'asc' },
  )

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('queueTitle')} />

      {q.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : !q.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" aria-hidden />}
          title={t('queueEmpty')}
          description={t('queueEmptyHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="student" sort={sort} onSort={toggle}>
                  {t('colStudent')}
                </TableHead>
                <TableHead sortKey="type" sort={sort} onSort={toggle} className={HIDE.type}>
                  {t('type')}
                </TableHead>
                <TableHead sortKey="when" sort={sort} onSort={toggle}>
                  {t('colWhen')}
                </TableHead>
                <TableHead sortKey="topic" sort={sort} onSort={toggle} className={HIDE.topic}>
                  {t('topic')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('colStatus')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <SkeletonRows />}
              {sorted.map((a) => {
                const active = a.status !== 'COMPLETED' && a.status !== 'CANCELLED'
                return (
                  <TableRow key={a.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <TableText value={`${a.student.lastName} ${a.student.firstName}`} />
                    </TableCell>
                    <TableCell className={cn(HIDE.type, 'text-muted-foreground')}>
                      <TableText value={t(apptTypeKey(a.type))} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {fmt(whenOf(a))}
                      {/* Пока приём не назначен, в колонке стоит пожелание студента —
                          без пометки его легко принять за подтверждённое время. */}
                      {a.scheduledAt === null && (
                        <span className="block text-xs">{t('requestedFor')}</span>
                      )}
                    </TableCell>
                    <TableCell className={cn(HIDE.topic, 'text-muted-foreground')}>
                      {a.topic ? <TableText value={a.topic} /> : <TableEmpty />}
                    </TableCell>
                    <TableCell>
                      <Badge variant={APPT_STATUS_BADGE[a.status]}>
                        {t(APPT_STATUS_KEY[a.status])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {active && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" icon aria-label={t('actions')}>
                              <MoreHorizontal className="size-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setModal({ id: a.id, mode: 'confirm' })}
                            >
                              <CheckCircle2 aria-hidden />
                              {t('confirm')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setModal({ id: a.id, mode: 'reschedule' })}
                            >
                              <Clock aria-hidden />
                              {t('reschedule')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => complete.mutate(a.id)}>
                              <CheckCircle2 aria-hidden />
                              {t('complete')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => cancel.mutate(a.id)}
                            >
                              <XCircle aria-hidden />
                              {t('cancelAppointment')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
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

// Те же классы скрытия, что и у данных: на время загрузки геометрия не меняется.
function SkeletonRows({ rows = 8 }: { rows?: number }) {
  const cells = [undefined, HIDE.type, undefined, HIDE.topic, undefined, undefined]
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {cells.map((cls, c) => (
            <TableCell key={c} className={cls}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}
