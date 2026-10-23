'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { GraduationCap, Inbox, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { EXAM_LIST_LIMIT, type ExamListQueryInput } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  DateRangePicker,
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
  parseYmd,
  useConfirm,
  useTableSort,
  type DateRange,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { Role } from '@studenthub/shared-types'
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

type TabId = 'upcoming' | 'past'
const TAB_ORDER: TabId[] = ['upcoming', 'past']

/** Начало дня "YYYY-MM-DD" по местному времени в ISO; `nextDay` — начало следующего дня. */
function dayStartIso(ymd: string, nextDay = false): string | undefined {
  const d = parseYmd(ymd)
  if (!d) return undefined
  if (nextDay) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/**
 * Параметры запроса вкладки. Граница вкладок — начало сегодняшнего дня: сегодняшние
 * экзамены, в том числе уже прошедшие утром, остаются в «предстоящих», где по ним и
 * заполняют ведомость. Период сужает вкладку. ISO-строки одного формата сравниваются
 * как даты.
 */
function examParams(tab: TabId, today: string, period: DateRange): Partial<ExamListQueryInput> {
  const from = period.from ? dayStartIso(period.from) : undefined
  const to = period.to ? dayStartIso(period.to, true) : undefined
  if (tab === 'upcoming') {
    return { from: from && from > today ? from : today, ...(to ? { to } : {}) }
  }
  return { ...(from ? { from } : {}), to: to && to < today ? to : today }
}

function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function ExamManagementView({ mine }: { mine: boolean }) {
  const t = useTranslations('Exams')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ExamItem | null>(null)
  const [rosterId, setRosterId] = useState<string | null>(null)
  const role = useAppSelector((s) => s.auth.role)
  const myId = useAppSelector((s) => s.auth.user?.id)
  // Экзаменатор, не читающий дисциплину, ведёт только ведомость: править и удалить экзамен
  // может преподаватель дисциплины или деканат (так же решает сервер).
  const canDelete = (e: ExamItem): boolean => role !== Role.TEACHER || e.course.teacherId === myId

  const [tab, setTab] = useState<TabId>('upcoming')
  const [period, setPeriod] = useState<DateRange>({ from: '', to: '' })
  // Граница вкладок фиксируется на время жизни экрана: «сейчас» в ключе запроса менялось бы
  // на каждом рендере.
  const [today] = useState(startOfToday)
  const params = useMemo(() => examParams(tab, today, period), [tab, today, period])

  // Сервер отдаёт экзамены вкладки, ближайшие к сегодняшнему дню, по возрастанию даты:
  // раньше у декана с сотнями экзаменов в выдачу попадали самые старые, без текущей сессии.
  const q = useQuery({ queryKey: examKeys.list(params), queryFn: () => fetchExams(params) })

  const remove = useMutation({
    mutationFn: (id: string) => deleteExamRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'CONFLICT' ? t('deleteHasResults') : tErr(code))
    },
  })

  // Предстоящие — ближайший сверху, прошедшие — свежий сверху: до нажатия на заголовок
  // таблица показывает то, что ближе всего к сегодняшнему дню.
  const rows = useMemo(() => {
    const list = q.data ?? []
    return tab === 'past' ? [...list].reverse() : list
  }, [q.data, tab])
  // Без начальной сортировки: порядок задаёт вкладка (см. `rows`).
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<ExamItem>(rows, (e, key) => {
    if (key === 'subject') return e.course.subject.name
    if (key === 'date') return e.date
    if (key === 'group') return e.group.name
    if (key === 'room') return e.room?.name ?? null
    if (key === 'format') return e.format
    return null
  })

  if (rosterId) {
    return (
      <ExamResultsRoster
        examId={rosterId}
        maxScore={rows.find((e) => e.id === rosterId)?.maxScore ?? null}
        onBack={() => setRosterId(null)}
      />
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('manageTitle')}
        tabs={
          <SegmentedTabs
            aria-label={t('manageTitle')}
            value={tab}
            onChange={setTab}
            items={TAB_ORDER.map((id) => ({ value: id, label: t(id) }))}
          />
        }
        actions={
          <>
            <DateRangePicker
              size="sm"
              className="w-60"
              value={period}
              onChange={setPeriod}
              aria-label={t('period')}
            />
            <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('newExam')}
            </Button>
          </>
        }
      />

      {q.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : !q.isLoading && rows.length === 0 && tab === 'past' ? (
        <EmptyState
          icon={<GraduationCap className="size-6" aria-hidden />}
          title={t('pastEmpty')}
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
                        {canDelete(e) && (
                          <>
                            <DropdownMenuItem onClick={() => setEditing(e)}>
                              <Pencil aria-hidden />
                              {t('edit')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={async () => {
                                // Необратимо, и группа получит уведомление об отмене —
                                // один промах по пункту меню не должен этого делать.
                                const ok = await confirm({
                                  title: t('confirmDeleteTitle'),
                                  // Об отмене сервер сообщает только по предстоящему.
                                  description: t(
                                    new Date(e.date).getTime() > Date.now()
                                      ? 'confirmDeleteDesc'
                                      : 'confirmDeletePastDesc',
                                    { subject: e.course.subject.name, group: e.group.name },
                                  ),
                                  confirmLabel: t('delete'),
                                  destructive: true,
                                })
                                if (ok) remove.mutate(e.id)
                              }}
                            >
                              <Trash2 aria-hidden />
                              {t('delete')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Список упёрся в потолок выдачи — честно говорим, что показана только часть. */}
      {rows.length >= EXAM_LIST_LIMIT && (
        <p className="text-xs text-muted-foreground">
          {t('listCapped', { count: EXAM_LIST_LIMIT })}
        </p>
      )}

      {creating && <CreateExamModal mine={mine} onClose={() => setCreating(false)} />}
      {editing && (
        <CreateExamModal
          key={editing.id}
          mine={mine}
          exam={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
