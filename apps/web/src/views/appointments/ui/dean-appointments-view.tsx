'use client'

import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  MoreHorizontal,
  XCircle,
} from 'lucide-react'
import {
  APPOINTMENT_TRANSITIONS,
  canAppointmentTransition,
  type AppointmentQueueView,
} from '@studenthub/shared-schemas'
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
  SegmentedTabs,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
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
  type AppointmentStatus,
} from '../../../entities/appointment'
import { APPT_STATUS_BADGE, APPT_STATUS_KEY, apptTypeKey } from '../lib/visuals'
import { ConfirmAppointmentModal } from './confirm-appointment-modal'

// Ширины колонок: тема тянет остаток — это единственное свободное поле в строке.
const COLS = ['22%', '15%', '15%', '28%', '14%', '3.5rem'] as const
// Узкий экран: доли пересчитаны на колонки, которые остаются видимыми (остальные скрыты
// классами HIDE). Без этого им доставалось по 30–40px и заголовок обрезался в многоточие.
// Остаются студент, время, статус и действие.
const COLS_NARROW = ['28%', '0', '22%', '0', '38%', '3.5rem'] as const
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
// Порядок и классы скрытия колонок — те же, что у строк с данными: на время загрузки
// геометрия таблицы не меняется.
const APPOINTMENT_SKELETON_COLS = [
  undefined,
  HIDE.type,
  undefined,
  HIDE.topic,
  undefined,
  undefined,
]

// Открытые записи — рабочая очередь, закрытые — архив. Раньше обе шли одним списком с
// потолком, и накопленный архив вытеснял из него новые записи.
type TabId = Extract<AppointmentQueueView, 'active' | 'closed'>
const TAB_ORDER: TabId[] = ['active', 'closed']
const TAB_LABEL: Record<TabId, string> = { active: 'tabActive', closed: 'tabClosed' }
// Страница выдачи; следующая — по кнопке «Показать ещё» (cursor = id последней записи).
const PAGE = 100

export function DeanAppointmentsView() {
  const t = useTranslations('Appointments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [modal, setModal] = useState<{ id: string; mode: 'confirm' | 'reschedule' } | null>(null)

  const [tab, setTab] = useState<TabId>('active')

  const q = useInfiniteQuery({
    queryKey: appointmentKeys.queue({ view: tab, limit: PAGE }),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchAppointmentQueue({ view: tab, limit: PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: Appointment[]) =>
      last.length === PAGE ? last[last.length - 1]?.id : undefined,
  })

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

  // Очередь — ближайший приём сверху: её разбирают по времени, а не по алфавиту. Архив —
  // свежий сверху. До нажатия на заголовок порядок задаёт вкладка.
  const rows = useMemo(() => {
    const list = q.data?.pages.flat() ?? []
    const dir = tab === 'active' ? 1 : -1
    return [...list].sort((a, b) => dir * whenOf(a).localeCompare(whenOf(b)))
  }, [q.data, tab])
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<Appointment>(rows, (a, key) => {
    if (key === 'student') return `${a.student.lastName} ${a.student.firstName}`
    if (key === 'type') return a.type
    if (key === 'when') return whenOf(a)
    if (key === 'topic') return a.topic
    if (key === 'status') return a.status
    return null
  })

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('queueTitle')}
        tabs={
          <SegmentedTabs
            aria-label={t('queueTitle')}
            value={tab}
            onChange={setTab}
            items={TAB_ORDER.map((id) => ({ value: id, label: t(TAB_LABEL[id]) }))}
          />
        }
      />

      {q.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : !q.isLoading && rows.length === 0 && tab === 'closed' ? (
        <EmptyState icon={<Archive className="size-6" aria-hidden />} title={t('archiveEmpty')} />
      ) : !q.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" aria-hidden />}
          title={t('queueEmpty')}
          description={t('queueEmptyHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
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
              {q.isLoading && <TableSkeletonRows columns={APPOINTMENT_SKELETON_COLS} />}
              {sorted.map((a) => {
                // Пункты меню — по той же таблице переходов, что проверяет сервер: иначе
                // «Завершить» неподтверждённую запись или «Подтвердить» подтверждённую
                // упирались в 409.
                const can = (to: AppointmentStatus) => canAppointmentTransition(a.status, to)
                const active = APPOINTMENT_TRANSITIONS[a.status].length > 0
                return (
                  <TableRow key={a.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <TableText value={`${a.student.lastName} ${a.student.firstName}`} />
                    </TableCell>
                    <TableCell className={cn(HIDE.type, 'text-muted-foreground')}>
                      <TableText value={t(apptTypeKey(a.type))} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums md:whitespace-nowrap">
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
                      <Badge variant={APPT_STATUS_BADGE[a.status]} className="max-w-full truncate">
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
                            {can('CONFIRMED') && (
                              <DropdownMenuItem
                                onClick={() => setModal({ id: a.id, mode: 'confirm' })}
                              >
                                <CheckCircle2 aria-hidden />
                                {t('confirm')}
                              </DropdownMenuItem>
                            )}
                            {can('RESCHEDULED') && (
                              <DropdownMenuItem
                                onClick={() => setModal({ id: a.id, mode: 'reschedule' })}
                              >
                                <Clock aria-hidden />
                                {t('reschedule')}
                              </DropdownMenuItem>
                            )}
                            {can('COMPLETED') && (
                              <DropdownMenuItem onClick={() => complete.mutate(a.id)}>
                                <CheckCircle2 aria-hidden />
                                {t('complete')}
                              </DropdownMenuItem>
                            )}
                            {can('CANCELLED') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => cancel.mutate(a.id)}
                                >
                                  <XCircle aria-hidden />
                                  {t('cancelAppointment')}
                                </DropdownMenuItem>
                              </>
                            )}
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
      {q.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          className="self-center"
          loading={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t('showMore')}
        </Button>
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
