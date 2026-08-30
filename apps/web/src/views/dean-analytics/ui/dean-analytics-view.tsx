'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  BookOpen,
  ChevronRight,
  FileClock,
  GraduationCap,
  Inbox,
  Percent,
  Users,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricTile,
  PageHeader,
  Progress,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { useAppSelector } from '../../../shared/store'
import { cn } from '../../../shared/lib/utils'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  analyticsKeys,
  fetchFacultyOverview,
  fetchAtRiskStudents,
  type AtRiskStudent,
  type GroupStat,
  type RiskReason,
} from '../../../entities/analytics'
import { GroupDrilldown } from './group-drilldown'

// Запасной порог «требует внимания» на случай, если сводка риска ещё не пришла:
// настоящее значение приходит с сервера в thresholds.attendance, и подпись берёт его —
// захардкоженная копия серверной константы рано или поздно разошлась бы с ней.
const LOW_ATTENDANCE_FALLBACK = 60

function rateTone(rate: number): string {
  return rate >= 75 ? 'bg-success' : rate >= 60 ? 'bg-warning' : 'bg-destructive'
}

type Tab = 'students' | 'groups'

// Аналитика факультета (задача 14): показатели, «требует внимания», drill-down по группам.
// У декана факультет один — берётся из токена. Админу и модератору вуза сервер факультет
// не выводит (analytics.service: resolveFaculty), поэтому им нужен выбор в шапке.
export function DeanAnalyticsView() {
  const t = useTranslations('Analytics')
  const role = useAppSelector((s) => s.auth.role)
  const picksFaculty = role !== null && role !== Role.DEAN
  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: picksFaculty,
  })
  const [facultyId, setFacultyId] = useState('')
  // Первый факультет выбираем сами: пустой экран с одним селектом ничего не сообщает.
  useEffect(() => {
    const first = faculties.data?.[0]
    if (picksFaculty && !facultyId && first) setFacultyId(first.id)
  }, [picksFaculty, facultyId, faculties.data])

  const ready = !picksFaculty || !!facultyId
  const scope = picksFaculty ? facultyId : undefined
  const q = useQuery({
    queryKey: analyticsKeys.faculty(scope),
    queryFn: () => fetchFacultyOverview(scope),
    enabled: ready,
  })
  // Early Warning (PR-7): студенты «требует внимания» с явными причинами.
  const risk = useQuery({
    queryKey: analyticsKeys.atRisk(scope),
    queryFn: () => fetchAtRiskStudents(scope),
    enabled: ready,
  })
  const [drillGroup, setDrillGroup] = useState<{ id: string; name: string } | null>(null)
  const [tab, setTab] = useState<Tab>('students')
  const lowAttendance = risk.data?.thresholds.attendance ?? LOW_ATTENDANCE_FALLBACK

  if (drillGroup) {
    return (
      <GroupDrilldown
        groupId={drillGroup.id}
        groupName={drillGroup.name}
        onBack={() => setDrillGroup(null)}
      />
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          picksFaculty ? (
            <Select value={facultyId} onValueChange={setFacultyId}>
              <SelectTrigger size="md" className="w-56" aria-label={t('faculty')}>
                <SelectValue placeholder={t('faculty')} />
              </SelectTrigger>
              <SelectContent>
                {faculties.data?.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (
        q.data && (
          <>
            {/* Показатели факультета — та же шкала плиток, что на дашборде вуза
                и в обзоре документов: иконка в чипе, число, подпись. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricTile icon={Users} label={t('kpi.students')} value={q.data.totals.students} />
              <MetricTile icon={BookOpen} label={t('kpi.groups')} value={q.data.totals.groups} />
              <MetricTile
                icon={Percent}
                tone="text-info"
                label={t('kpi.attendance')}
                value={`${q.data.totals.attendanceRate}%`}
                valueTone={
                  q.data.totals.attendanceRate < lowAttendance ? 'text-destructive' : undefined
                }
              />
              <MetricTile
                icon={FileClock}
                tone="text-warning"
                label={t('kpi.submissionsPending')}
                value={q.data.totals.submissionsPending}
              />
              <MetricTile
                icon={GraduationCap}
                label={t('kpi.examsUpcoming')}
                value={q.data.totals.examsUpcoming}
              />
            </div>

            {/*
              Два разреза одних и тех же данных: поимённо и по группам. Раньше они шли
              подряд одной колонкой, и таблица студентов вытесняла группы за нижний край
              экрана — до них не доходили. Табы дают выбрать разрез, а не прокручивать.
            */}
            <SegmentedTabs
              aria-label={t('title')}
              value={tab}
              onChange={setTab}
              items={[
                {
                  value: 'students',
                  label: t('tabStudents'),
                  count: risk.data?.students.length ?? 0,
                },
                { value: 'groups', label: t('tabGroups'), count: q.data.groups.length },
              ]}
              className="self-start"
            />

            {tab === 'students' ? (
              <RiskStudentsTab
                students={risk.data?.students ?? []}
                totalStudents={q.data.totals.students}
                loading={risk.isLoading}
              />
            ) : (
              <GroupsTab
                groups={q.data.groups}
                threshold={lowAttendance}
                onOpen={(g) => setDrillGroup({ id: g.groupId, name: g.name })}
              />
            )}
          </>
        )
      )}
    </div>
  )
}

/** Шапка вкладки: пояснение слева, счётчик справа. Одна на оба разреза. */
function TabHeader({ hint, count }: { hint: string; count: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{hint}</p>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
    </div>
  )
}

// ── Вкладка «Требуют внимания» ───────────────────────────────────────────────

/** Строка таблицы риска: причины разложены по колонкам, отсутствующая — прочерк. */
interface RiskRow {
  studentId: string
  name: string
  groupName: string | null
  attendance: number | null
  overdue: number | null
  grade: number | null
  problems: number
}

function toRiskRow(s: AtRiskStudent): RiskRow {
  const valueOf = (kind: RiskReason['kind']): number | null =>
    s.reasons.find((r) => r.kind === kind)?.value ?? null
  return {
    studentId: s.studentId,
    name: `${s.lastName} ${s.firstName}`,
    groupName: s.groupName,
    attendance: valueOf('LOW_ATTENDANCE'),
    overdue: valueOf('OVERDUE_ASSIGNMENTS'),
    grade: valueOf('LOW_GRADES'),
    problems: s.reasons.length,
  }
}

/**
 * Порядок по умолчанию — лексикографический, а не взвешенный балл: каждый шаг
 * объясним словами и написан в подписи вкладки. Сервер сортирует только по числу
 * причин, поэтому студент с тремя просрочками оказывался посреди списка тех, у кого
 * одна, — по алфавиту. Здесь при равном числе причин вперёд выходит тот, у кого хуже
 * само значение.
 */
function byRisk(a: RiskRow, b: RiskRow): number {
  if (a.problems !== b.problems) return b.problems - a.problems
  if (a.attendance !== b.attendance) return (a.attendance ?? 101) - (b.attendance ?? 101)
  if (a.overdue !== b.overdue) return (b.overdue ?? 0) - (a.overdue ?? 0)
  if (a.grade !== b.grade) return (a.grade ?? 101) - (b.grade ?? 101)
  return a.name.localeCompare(b.name)
}

const RISK_COLS = ['28%', '14%', '19%', '19%', '20%'] as const
const RISK_HIDE = { group: 'hidden sm:table-cell', grade: 'hidden md:table-cell' } as const

/**
 * Именной список риска.
 *
 * Был плоским списком с чипами: у всех «Просрочено: 1», и семьдесят одинаковых строк
 * не отвечали ни на один вопрос. В колонках видно, у кого какая беда и насколько
 * велика, а счётчики над таблицей сразу показывают форму проблемы на факультете:
 * массовые просрочки — это не то же самое, что трое с проваленной посещаемостью.
 */
function RiskStudentsTab({
  students,
  totalStudents,
  loading,
}: {
  students: AtRiskStudent[]
  totalStudents: number
  loading: boolean
}) {
  const t = useTranslations('Analytics')
  const rows = useMemo(() => students.map(toRiskRow).sort(byRisk), [students])
  const counts = useMemo(
    () => ({
      attendance: rows.filter((r) => r.attendance !== null).length,
      overdue: rows.filter((r) => r.overdue !== null).length,
      grade: rows.filter((r) => r.grade !== null).length,
    }),
    [rows],
  )
  // initial = null: пока по колонке не кликнули, порядок остаётся риск-сортировкой выше.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<RiskRow>(rows, (r, key) => {
    if (key === 'name') return r.name
    if (key === 'group') return r.groupName
    if (key === 'attendance') return r.attendance
    if (key === 'overdue') return r.overdue
    if (key === 'grade') return r.grade
    return null
  })

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-6" aria-hidden />}
        title={t('riskEmpty')}
        description={t('riskEmptyHint')}
      />
    )
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
      <TabHeader
        hint={t('riskStudentsHint')}
        count={t('riskCount', { n: rows.length, total: totalStudents })}
      />

      {/* Счётчики по причинам: отвечают на «что именно происходит», до чтения строк. */}
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
        <Badge variant="destructive">{t('countAttendance', { n: counts.attendance })}</Badge>
        <Badge variant="secondary">{t('countOverdue', { n: counts.overdue })}</Badge>
        <Badge variant="destructive">{t('countGrade', { n: counts.grade })}</Badge>
      </div>

      <Table fixed scrollBody fill cols={RISK_COLS}>
        <TableHeader>
          <TableRow>
            <TableHead sortKey="name" sort={sort} onSort={toggle}>
              {t('colStudent')}
            </TableHead>
            <TableHead sortKey="group" sort={sort} onSort={toggle} className={RISK_HIDE.group}>
              {t('colGroup')}
            </TableHead>
            <TableHead numeric sortKey="attendance" sort={sort} onSort={toggle}>
              {t('colAttendance')}
            </TableHead>
            <TableHead numeric sortKey="overdue" sort={sort} onSort={toggle}>
              {t('colOverdue')}
            </TableHead>
            <TableHead
              numeric
              sortKey="grade"
              sort={sort}
              onSort={toggle}
              className={RISK_HIDE.grade}
            >
              {t('colGrade')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.studentId} className="hover:bg-muted/40">
              <TableCell className="font-medium">
                <TableText value={r.name} />
              </TableCell>
              <TableCell className={cn(RISK_HIDE.group, 'text-muted-foreground')}>
                {r.groupName ? <TableText value={r.groupName} /> : <TableEmpty />}
              </TableCell>
              {/* Прочерк, а не ноль: причина не сработала — это не «ноль процентов». */}
              <TableCell className="text-right tabular-nums text-destructive">
                {r.attendance !== null ? `${r.attendance}%` : <TableEmpty />}
              </TableCell>
              <TableCell className="text-right tabular-nums text-warning-foreground dark:text-warning">
                {r.overdue ?? <TableEmpty />}
              </TableCell>
              <TableCell
                className={cn(RISK_HIDE.grade, 'text-right tabular-nums text-destructive')}
              >
                {r.grade !== null ? `${r.grade}%` : <TableEmpty />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

// ── Вкладка «Группы» ─────────────────────────────────────────────────────────

const GROUP_COLS = ['30%', '12%', 'auto', '3.5rem'] as const

/**
 * Все группы факультета.
 *
 * По возрастанию посещаемости: сверху те, с кого начинают разбор. Отдельной панели
 * «группы ниже порога» больше нет — она показывала ровно начало этого же списка,
 * а здесь то же самое видно по тону числа и бейджу «Риск».
 */
function GroupsTab({
  groups,
  threshold,
  onOpen,
}: {
  groups: GroupStat[]
  threshold: number
  onOpen: (g: GroupStat) => void
}) {
  const t = useTranslations('Analytics')
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<GroupStat>(
    groups,
    (g, key) => {
      if (key === 'name') return g.name
      if (key === 'students') return g.students
      // Группа без отметок — не «ноль процентов», а «нечего считать»: уводим в конец.
      if (key === 'rate') return g.attendanceTracked > 0 ? g.attendanceRate : null
      return null
    },
    { key: 'rate', dir: 'asc' },
  )

  if (groups.length === 0) {
    return <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('noGroups')} />
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
      <TabHeader hint={t('groupsHint')} count={t('groupsCount', { n: groups.length })} />

      <Table fixed scrollBody fill cols={GROUP_COLS}>
        <TableHeader>
          <TableRow>
            <TableHead sortKey="name" sort={sort} onSort={toggle}>
              {t('colGroup')}
            </TableHead>
            <TableHead numeric sortKey="students" sort={sort} onSort={toggle}>
              {t('colStudents')}
            </TableHead>
            <TableHead sortKey="rate" sort={sort} onSort={toggle}>
              {t('colAttendance')}
            </TableHead>
            <TableHead>
              <span className="sr-only">{t('groupAttendance')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((g) => {
            const tracked = g.attendanceTracked > 0
            const atRisk = tracked && g.attendanceRate < threshold
            return (
              <TableRow
                key={g.groupId}
                onClick={() => onOpen(g)}
                className="cursor-pointer hover:bg-muted/40"
              >
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <TableText value={g.name} />
                    {atRisk && <Badge variant="destructive">{t('risk')}</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {g.students}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Progress
                      value={g.attendanceRate}
                      indicatorClassName={rateTone(g.attendanceRate)}
                    />
                    <span
                      className={cn(
                        'w-10 shrink-0 text-right text-xs tabular-nums',
                        atRisk && 'font-medium text-destructive',
                      )}
                    >
                      {tracked ? `${g.attendanceRate}%` : '—'}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
