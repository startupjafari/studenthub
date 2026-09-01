'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { GraduationCap, Inbox, MoreHorizontal, Plus, Trash2, Users } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
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
import { examKeys, fetchExams, deleteExamRequest, type ExamItem } from '../../../entities/exam'
import { examFormatKey } from '../lib/visuals'
import { CreateExamModal } from './create-exam-modal'
import { ExamResultsRoster } from './exam-results-roster'

// Дисциплина забирает остаток ширины: остальные колонки — короткие и предсказуемые.
const COLS = ['32%', '18%', '14%', '14%', '16%', '3.5rem'] as const
// Узкий экран: доли пересчитаны на колонки, которые остаются видимыми (остальные скрыты
// классами HIDE). Без этого им доставалось по 30–40px и заголовок обрезался в многоточие.
// Остаются дисциплина, дата, формат и действие.
const COLS_NARROW = ['34%', '22%', '0', '0', '32%', '3.5rem'] as const
// Узкий экран оставляет дисциплину, дату и формат — по ним сессию и читают.
const HIDE = { group: 'hidden md:table-cell', room: 'hidden lg:table-cell' } as const

// Управление экзаменами (декан/преподаватель): список + назначение + ведомость.
// Порядок и классы скрытия колонок — те же, что у строк с данными: на время загрузки
// геометрия таблицы не меняется.
const EXAM_SKELETON_COLS = [undefined, undefined, HIDE.group, HIDE.room, undefined, undefined]

export function ExamManagementView({ mine }: { mine: boolean }) {
  const t = useTranslations('Exams')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [rosterId, setRosterId] = useState<string | null>(null)

  const q = useQuery({ queryKey: examKeys.list(), queryFn: () => fetchExams() })

  const remove = useMutation({
    mutationFn: (id: string) => deleteExamRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const rows = q.data ?? []
  // По умолчанию — ближайший экзамен сверху: сессию читают по датам.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<ExamItem>(
    rows,
    (e, key) => {
      if (key === 'subject') return e.course.subject.name
      if (key === 'date') return e.date
      if (key === 'group') return e.group.name
      if (key === 'room') return e.room?.name ?? null
      if (key === 'format') return e.format
      return null
    },
    { key: 'date', dir: 'asc' },
  )

  if (rosterId) {
    return <ExamResultsRoster examId={rosterId} onBack={() => setRosterId(null)} />
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('manageTitle')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newExam')}
          </Button>
        }
      />

      {q.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : !q.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-6" aria-hidden />}
          title={t('manageEmpty')}
          description={t('manageEmptyHint')}
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('newExam')}
            </Button>
          }
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="subject" sort={sort} onSort={toggle}>
                  {t('colSubject')}
                </TableHead>
                <TableHead sortKey="date" sort={sort} onSort={toggle}>
                  {t('colDate')}
                </TableHead>
                <TableHead sortKey="group" sort={sort} onSort={toggle} className={HIDE.group}>
                  {t('colGroup')}
                </TableHead>
                <TableHead sortKey="room" sort={sort} onSort={toggle} className={HIDE.room}>
                  {t('colRoom')}
                </TableHead>
                <TableHead sortKey="format" sort={sort} onSort={toggle}>
                  {t('format')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableSkeletonRows columns={EXAM_SKELETON_COLS} />}
              {sorted.map((e) => (
                <TableRow
                  key={e.id}
                  onClick={() => setRosterId(e.id)}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <TableCell className="font-medium">
                    <TableText value={e.course.subject.name} />
                  </TableCell>
                  {/* До `md` дата переносится на две строки: `nowrap` в узкой колонке
                      вылезал на соседнюю. */}
                  <TableCell className="text-muted-foreground tabular-nums md:whitespace-nowrap">
                    {new Date(e.date).toLocaleString(locale, {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className={cn(HIDE.group, 'text-muted-foreground')}>
                    <TableText value={e.group.name} />
                  </TableCell>
                  <TableCell className={cn(HIDE.room, 'text-muted-foreground')}>
                    {e.room ? <TableText value={e.room.name} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="max-w-full truncate">
                      {t(examFormatKey(e.format))}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('actions')}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRosterId(e.id)}>
                          <Users aria-hidden />
                          {t('openRoster')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(e.id)}>
                          <Trash2 aria-hidden />
                          {t('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {creating && <CreateExamModal mine={mine} onClose={() => setCreating(false)} />}
    </div>
  )
}
