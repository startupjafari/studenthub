'use client'

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { GraduationCap, Inbox, Milestone, TrendingUp } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricTile,
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
import { cn } from '../../../shared/lib/utils'
import { courseKeys, fetchCourses, type CourseItem } from '../../../entities/course'
import { gradebookKeys, fetchMyGrades, type MyGradesCourse } from '../../../entities/gradebook'

type PlanStatus = 'completed' | 'studying' | 'upcoming' | 'notPassed'

const STATUS_BADGE: Record<PlanStatus, 'success' | 'info' | 'secondary' | 'destructive'> = {
  completed: 'success',
  studying: 'info',
  upcoming: 'secondary',
  notPassed: 'destructive',
}

const PASS_THRESHOLD = 50

// Процент по дисциплине из опубликованных оценок (avg score/maxScore).
function gradePercent(mg: MyGradesCourse | undefined): number | null {
  if (!mg) return null
  const scored = mg.columns
    .filter((c) => c.maxScore != null && c.score != null)
    .map((c) => (c.score as number) / (c.maxScore as number))
  if (scored.length === 0) return null
  return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
}

function statusOf(course: CourseItem, pct: number | null): PlanStatus {
  if (pct !== null) return pct >= PASS_THRESHOLD ? 'completed' : 'notPassed'
  if (course.term?.isActive) return 'studying'
  return 'upcoming'
}

interface PlanCourse {
  course: CourseItem
  /** Подпись семестра: в таблице она колонка, а не заголовок секции. */
  term: string
  /** Номер семестра — порядок строк по умолчанию и ключ сортировки колонки. */
  termOrder: number
  pct: number | null
  status: PlanStatus
}

// Дисциплина · семестр · кредиты · результат · статус.
const COLS = ['34%', '20%', '7rem', '7rem', '10rem'] as const
// До `md` остаются дисциплина, результат и статус — по ним план и читают.
const COLS_NARROW = ['46%', '0', '0', '22%', '32%'] as const
const HIDE = {
  term: 'hidden md:table-cell',
  credits: 'hidden md:table-cell',
} as const

// «Учебный план» студента (задача 13): дисциплины по семестрам, статусы, прогресс по кредитам.
export function StudyPlanView() {
  const t = useTranslations('StudyPlan')
  const courses = useQuery({ queryKey: courseKeys.list(), queryFn: () => fetchCourses() })
  const grades = useQuery({
    queryKey: gradebookKeys.me(),
    queryFn: () => fetchMyGrades(),
    retry: false,
  })

  const model = useMemo(() => {
    const list = courses.data ?? []
    const gradeByCourse = new Map((grades.data ?? []).map((g) => [g.courseId, g]))
    const plan: PlanCourse[] = list.map((course) => {
      const pct = gradePercent(gradeByCourse.get(course.id))
      return {
        course,
        term: course.term?.name ?? t('noTerm'),
        termOrder: course.term?.number ?? 9999,
        pct,
        status: statusOf(course, pct),
      }
    })

    // Порядок строк по умолчанию — по семестрам, как были секции: пока читатель не
    // нажал заголовок, план идёт в учебной последовательности, а не вперемешку.
    const rows = [...plan].sort(
      (a, b) =>
        a.termOrder - b.termOrder || a.course.subject.name.localeCompare(b.course.subject.name),
    )

    let totalCredits = 0
    let doneCredits = 0
    for (const p of plan) {
      const cr = p.course.credits ?? 0
      totalCredits += cr
      if (p.status === 'completed') doneCredits += cr
    }
    const progress = totalCredits === 0 ? 0 : Math.round((doneCredits / totalCredits) * 100)

    return { rows, totalCredits, doneCredits, progress }
  }, [courses.data, grades.data, t])

  // Сортировка клиентская: весь план приходит одним запросом, сервер здесь ни при чём.
  // Статус сравниваем по переводу — алфавит языка интерфейса, а не порядок значений.
  const sortValue = useCallback(
    (p: PlanCourse, key: string) => {
      switch (key) {
        case 'term':
          return p.termOrder
        case 'credits':
          return p.course.credits
        case 'pct':
          return p.pct
        case 'status':
          return t(`status.${p.status}`)
        default:
          return p.course.subject.name
      }
    },
    [t],
  )
  // Без начальной сортировки: строки идут в учебном порядке, пока не нажат заголовок.
  const { rows, sort, toggle } = useTableSort(model.rows, sortValue)

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} />

      {courses.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : courses.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => courses.refetch()}>{t('retry')}</Button>}
        />
      ) : (courses.data ?? []).length === 0 ? (
        <EmptyState icon={<GraduationCap />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricTile
              index={0}
              icon={Milestone}
              tone="text-warning"
              label={t('credits')}
              value={`${model.doneCredits} / ${model.totalCredits}`}
            />
            <MetricTile
              index={1}
              icon={TrendingUp}
              tone="text-success"
              label={t('progress')}
              value={`${model.progress}%`}
              progress={model.progress}
              progressTone="bg-success"
            />
          </div>

          {/* Таблица вместо карточек-семестров: семестр стал колонкой, и план целиком
              можно пересортировать — по результату, кредитам или статусу. */}
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
              <TableHeader>
                <TableRow>
                  <TableHead sortKey="subject" sort={sort} onSort={toggle}>
                    {t('colSubject')}
                  </TableHead>
                  <TableHead sortKey="term" sort={sort} onSort={toggle} className={HIDE.term}>
                    {t('colTerm')}
                  </TableHead>
                  <TableHead
                    numeric
                    sortKey="credits"
                    sort={sort}
                    onSort={toggle}
                    className={HIDE.credits}
                  >
                    {t('colCredits')}
                  </TableHead>
                  <TableHead numeric sortKey="pct" sort={sort} onSort={toggle}>
                    {t('colResult')}
                  </TableHead>
                  <TableHead sortKey="status" sort={sort} onSort={toggle}>
                    {t('colStatus')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.course.id}>
                    <TableCell className="font-medium">
                      <TableText value={p.course.subject.name} />
                    </TableCell>
                    <TableCell className={cn(HIDE.term, 'text-muted-foreground')}>
                      <TableText value={p.term} />
                    </TableCell>
                    <TableCell className={cn(HIDE.credits, 'text-right tabular-nums')}>
                      {p.course.credits ?? <TableEmpty />}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {p.pct !== null ? `${p.pct}%` : <TableEmpty />}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[p.status]}>{t(`status.${p.status}`)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
