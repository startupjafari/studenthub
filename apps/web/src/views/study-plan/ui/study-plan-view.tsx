'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { GraduationCap, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Progress,
  Skeleton,
} from '../../../shared/ui'
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
  pct: number | null
  status: PlanStatus
}

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
      return { course, pct, status: statusOf(course, pct) }
    })

    // Группировка по семестру.
    const groups = new Map<string, { label: string; order: number; items: PlanCourse[] }>()
    for (const p of plan) {
      const term = p.course.term
      const key = term?.id ?? 'none'
      const label = term?.name ?? t('noTerm')
      const order = term?.number ?? 9999
      if (!groups.has(key)) groups.set(key, { label, order, items: [] })
      groups.get(key)!.items.push(p)
    }
    const sortedGroups = [...groups.values()].sort((a, b) => a.order - b.order)

    let totalCredits = 0
    let doneCredits = 0
    for (const p of plan) {
      const cr = p.course.credits ?? 0
      totalCredits += cr
      if (p.status === 'completed') doneCredits += cr
    }
    const progress = totalCredits === 0 ? 0 : Math.round((doneCredits / totalCredits) * 100)

    return { groups: sortedGroups, totalCredits, doneCredits, progress }
  }, [courses.data, grades.data, t])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="font-heading text-2xl font-semibold tabular-nums">
                    {model.doneCredits} / {model.totalCredits}
                  </div>
                  <div className="text-sm text-muted-foreground">{t('credits')}</div>
                </div>
                <div className="text-right">
                  <div className="font-heading text-2xl font-semibold tabular-nums">
                    {model.progress}%
                  </div>
                  <div className="text-xs text-muted-foreground">{t('progress')}</div>
                </div>
              </div>
              <Progress value={model.progress} indicatorClassName="bg-success" />
            </CardContent>
          </Card>

          {model.groups.map((g) => (
            <Card key={g.label}>
              <CardHeader>
                <CardTitle className="text-base">{g.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border">
                  {g.items.map((p) => (
                    <li key={p.course.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {p.course.subject.name}
                        </span>
                        {p.course.credits != null && (
                          <span className="text-xs text-muted-foreground">
                            {t('creditsN', { n: p.course.credits })}
                          </span>
                        )}
                      </span>
                      {p.pct !== null && (
                        <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
                          {p.pct}%
                        </span>
                      )}
                      <Badge variant={STATUS_BADGE[p.status]} className="shrink-0">
                        {t(`status.${p.status}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
