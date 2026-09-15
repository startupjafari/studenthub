'use client'

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ClipboardList, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
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
import { cn } from '../../../shared/lib/utils'
import {
  assignmentKeys,
  fetchAssignments,
  fetchAssignment,
  type AssignmentItem,
} from '../../../entities/assignment'
import {
  studentStatus,
  STUDENT_STATUS_BADGE,
  STUDENT_STATUS_KEY,
  type StudentStatus,
} from '../lib/assignment-status'
import { StudentAssignmentDetail } from './student-assignment-detail'

type TabId = 'active' | 'submitted' | 'graded' | 'overdue'

// «Активные» — всё, по чему студенту ещё предстоит работать: не начато, черновик и
// возвращённое на исправление. Остальные вкладки повторяют статус один в один.
const TAB_STATUSES: Record<TabId, StudentStatus[]> = {
  active: ['NOT_STARTED', 'DRAFT', 'RETURNED'],
  submitted: ['SUBMITTED'],
  graded: ['GRADED'],
  overdue: ['OVERDUE'],
}
const TAB_LABEL: Record<TabId, string> = {
  active: 'tabActive',
  submitted: 'status.submitted',
  graded: 'status.graded',
  overdue: 'status.overdue',
}
const TAB_ORDER: TabId[] = ['active', 'submitted', 'graded', 'overdue']

// Задание · дисциплина · срок · балл · статус.
const COLS = ['32%', '24%', '9rem', '7rem', '12rem'] as const
// До `md` остаются задание, балл и статус — по ним список и читают.
const COLS_NARROW = ['46%', '0', '0', '18%', '36%'] as const
const HIDE = {
  subject: 'hidden md:table-cell',
  due: 'hidden lg:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [undefined, HIDE.subject, HIDE.due, undefined, undefined]

// «Задания» студента (задача 3): вкладки по статусу, таблица с сортировкой на клиенте
// и деталь/сдача в модальном окне — та же структура, что на экране «Заявки».
export function StudentAssignmentsView() {
  const t = useTranslations('Assignments')
  const locale = useLocale()
  // Диплинк из курса/поиска: /assignments?open=<id> сразу раскрывает деталь задания
  // (детали живут экранным состоянием, отдельного роута /assignments/[id] нет).
  const searchParams = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get('open'))
  const [tab, setTab] = useState<TabId>('active')
  const qc = useQueryClient()

  const q = useQuery({ queryKey: assignmentKeys.list(), queryFn: () => fetchAssignments() })

  // Prefetch детали задания при наведении/фокусе строки (принцип 3): к клику деталь уже в кэше,
  // окно открывается мгновенно. staleTime гасит повторные prefetch по одному id.
  const prefetch = (id: string): void => {
    void qc.prefetchQuery({
      queryKey: assignmentKeys.detail(id),
      queryFn: () => fetchAssignment(id),
      staleTime: 30_000,
    })
  }

  const grouped = useMemo(() => {
    const by: Record<TabId, AssignmentItem[]> = {
      active: [],
      submitted: [],
      graded: [],
      overdue: [],
    }
    for (const a of q.data ?? []) {
      const st = studentStatus(a)
      const tabId = TAB_ORDER.find((id) => TAB_STATUSES[id].includes(st))
      if (tabId) by[tabId].push(a)
    }
    return by
  }, [q.data])

  const current = grouped[tab]

  // Сортировка клиентская: весь список приходит одним запросом, серверу пересортировывать
  // нечего. Статус сравниваем по переводу — алфавит языка интерфейса, а не порядок enum.
  const sortValue = useCallback(
    (a: AssignmentItem, key: string) => {
      switch (key) {
        case 'subject':
          return a.course.subject.name
        case 'due':
          return a.dueAt ? new Date(a.dueAt).getTime() : null
        case 'score':
          return a.mySubmission?.score ?? null
        case 'status':
          return t(STUDENT_STATUS_KEY[studentStatus(a)])
        default:
          return a.title
      }
    },
    [t],
  )
  // Без начальной сортировки: порядок задаёт сервер.
  const { rows, sort, toggle } = useTableSort(current, sortValue)

  // Задание открывается окном поверх списка — как заявка: список не размонтируется,
  // вкладка и прокрутка сохраняются.
  const detailNode = openId && (
    <StudentAssignmentDetail asModal id={openId} onBack={() => setOpenId(null)} />
  )

  const tabsNode = (
    <SegmentedTabs
      aria-label={t('title')}
      value={tab}
      onChange={setTab}
      items={TAB_ORDER.map((id) => ({
        value: id,
        label: t(TAB_LABEL[id]),
        count: grouped[id].length,
      }))}
    />
  )

  return (
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader title={t('title')} tabs={tabsNode} />

        {q.isError ? (
          <EmptyState
            icon={<Inbox />}
            title={t('loadError')}
            action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
          />
        ) : !q.isLoading && current.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title={t('empty')} description={t('emptyHint')} />
        ) : (
          // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы
          // и просвет под последней строкой — таблица занимает карточку целиком.
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
              <TableHeader>
                <TableRow>
                  <TableHead sortKey="title" sort={sort} onSort={toggle}>
                    {t('colTitle')}
                  </TableHead>
                  <TableHead sortKey="subject" sort={sort} onSort={toggle} className={HIDE.subject}>
                    {t('colSubject')}
                  </TableHead>
                  <TableHead sortKey="due" sort={sort} onSort={toggle} className={HIDE.due}>
                    {t('colDue')}
                  </TableHead>
                  <TableHead numeric sortKey="score" sort={sort} onSort={toggle}>
                    {t('score')}
                  </TableHead>
                  <TableHead sortKey="status" sort={sort} onSort={toggle}>
                    {t('colStatus')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
                {rows.map((a) => {
                  const st = studentStatus(a)
                  const score = a.mySubmission?.score
                  return (
                    <TableRow
                      key={a.id}
                      tabIndex={0}
                      aria-haspopup="dialog"
                      onClick={() => setOpenId(a.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpenId(a.id)
                        }
                      }}
                      onMouseEnter={() => prefetch(a.id)}
                      onFocus={() => prefetch(a.id)}
                      className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    >
                      <TableCell className="font-medium">
                        <TableText value={a.title} />
                      </TableCell>
                      <TableCell className={cn(HIDE.subject, 'text-muted-foreground')}>
                        <TableText value={a.course.subject.name} />
                      </TableCell>
                      <TableCell className={cn(HIDE.due, 'text-muted-foreground tabular-nums')}>
                        {a.dueAt ? (
                          new Date(a.dueAt).toLocaleDateString(locale, {
                            day: '2-digit',
                            month: 'short',
                          })
                        ) : (
                          <TableEmpty />
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {score != null ? (
                          `${score}${a.maxScore != null ? ` / ${a.maxScore}` : ''}`
                        ) : (
                          <TableEmpty />
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STUDENT_STATUS_BADGE[st]}>
                          {t(STUDENT_STATUS_KEY[st])}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
      {detailNode}
    </>
  )
}
