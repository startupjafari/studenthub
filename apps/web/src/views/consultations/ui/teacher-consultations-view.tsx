'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, MapPin, MessagesSquare, Plus, Trash2, Video } from 'lucide-react'
import type { ConsultationSort } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useConfirm,
  usePagedSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import {
  consultationKeys,
  fetchMyConsultations,
  deleteSlotRequest,
  cancelSlotRequest,
  type ConsultationSlot,
  type ConsultationStatus,
} from '../../../entities/consultation'
import { CreateSlotModal } from './create-slot-modal'

const STATUS_BADGE: Record<ConsultationStatus, 'secondary' | 'success' | 'outline'> = {
  OPEN: 'secondary',
  BOOKED: 'success',
  CANCELLED: 'outline',
}

// Ширины колонок: время · статус · студент · место · тема · действие.
const COLS = ['22%', '10%', '20%', '16%', '22%', '7rem'] as const
// На узком экране остаются время, статус и действие: место и тема — уточнения,
// без них строка всё ещё отвечает «когда и занято ли».
const COLS_NARROW = ['46%', '18%', '0', '0', '0', '7rem'] as const
const HIDE = {
  student: 'hidden md:table-cell',
  location: 'hidden lg:table-cell',
  topic: 'hidden lg:table-cell',
}
const SKELETON_COLS = 6
const PAGE_SIZES = [20, 50, 100] as const

function slotTime(locale: string, s: ConsultationSlot): string {
  const start = new Date(s.startsAt)
  const end = new Date(s.endsAt)
  return `${start.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * «Консультации» преподавателя (задача 15): свои слоты и записи студентов.
 *
 * Таблица, а не список карточек: слотов у преподавателя за семестр набираются сотни,
 * и в карточках их нельзя было ни упорядочить, ни пролистать — сервер отдавал первые
 * двести, отсортированные по времени, и всё.
 *
 * Страница и порядок считаются НА СЕРВЕРЕ (`usePagedSort` → query → API). Сортировка
 * в браузере переставляла бы только текущую страницу: слот с самой ранней датой мог
 * лежать на третьей, и «сортировка по дате» показывала бы неправду.
 */
export function TeacherConsultationsView() {
  const t = useTranslations('Consultations')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const paged = usePagedSort<ConsultationSort>()

  const q = useQuery({
    queryKey: consultationKeys.mine(paged.query),
    queryFn: () => fetchMyConsultations(paged.query),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteSlotRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.all })
      toast.success(t('slotDeleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSlotRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.all })
      toast.success(t('cancelled'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  async function onRemove(s: ConsultationSlot) {
    const ok = await confirm({
      title: t('confirmDelete'),
      description: slotTime(locale, s),
      destructive: true,
    })
    if (ok) remove.mutate(s.id)
  }

  const rows = q.data?.items ?? []
  const total = q.data?.total ?? 0

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('manageTitle')}
        actions={
          <Button size="md" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newSlot')}
          </Button>
        }
      />

      {!q.isLoading && total === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title={t('manageEmpty')}
          description={t('manageEmptyHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="startsAt" sort={paged.sort} onSort={paged.toggle}>
                  {t('colTime')}
                </TableHead>
                <TableHead sortKey="status" sort={paged.sort} onSort={paged.toggle}>
                  {t('colStatus')}
                </TableHead>
                <TableHead
                  sortKey="student"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.student}
                >
                  {t('colStudent')}
                </TableHead>
                <TableHead className={HIDE.location}>{t('colLocation')}</TableHead>
                <TableHead className={HIDE.topic}>{t('colTopic')}</TableHead>
                <TableHead className="text-right">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <TableText value={slotTime(locale, s)} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[s.status]}>{t(`status.${s.status}`)}</Badge>
                  </TableCell>
                  <TableCell className={cn(HIDE.student, 'text-muted-foreground')}>
                    {s.student ? (
                      <TableText value={`${s.student.lastName} ${s.student.firstName}`} />
                    ) : (
                      <TableEmpty />
                    )}
                  </TableCell>
                  <TableCell className={cn(HIDE.location, 'text-muted-foreground')}>
                    {s.isOnline ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Video className="size-3.5 shrink-0" aria-hidden />
                        {t('online')}
                      </span>
                    ) : s.location ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        <TableText value={s.location} />
                      </span>
                    ) : (
                      <TableEmpty />
                    )}
                  </TableCell>
                  <TableCell className={cn(HIDE.topic, 'text-muted-foreground')}>
                    {s.topic ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MessagesSquare className="size-3.5 shrink-0" aria-hidden />
                        <TableText value={s.topic} />
                      </span>
                    ) : (
                      <TableEmpty />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === 'BOOKED' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={cancel.isPending && cancel.variables === s.id}
                        onClick={() => cancel.mutate(s.id)}
                      >
                        {t('cancelSlot')}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('delete')}
                        loading={remove.isPending && remove.variables === s.id}
                        onClick={() => onRemove(s)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={paged.page}
            total={total}
            limit={paged.limit}
            onPageChange={paged.setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={paged.setLimit}
          />
        </Card>
      )}

      {creating && <CreateSlotModal onClose={() => setCreating(false)} />}
    </div>
  )
}
