'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Award,
  Check,
  ClipboardCheck,
  Clock,
  FileCheck2,
  GraduationCap,
  Milestone,
  Send,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react'
import { EmptyState, MetricTile, PageHeader, SectionPanel, Skeleton } from '../../../shared/ui'
import { useChartTheme } from '../../../shared/ui/chart'
import { fetchMe, userKeys } from '../../../entities/user'
import { gradebookKeys, fetchMyGrades, type MyGradesCourse } from '../../../entities/gradebook'
import { attendanceKeys, fetchMyAttendance } from '../../../entities/attendance'
import { examKeys, fetchExams } from '../../../entities/exam'
import {
  assignmentKeys,
  fetchAssignments,
  studentAssignmentStatus,
} from '../../../entities/assignment'

// Тяжёлый recharts — только на клиенте, со скелетоном (FRONTEND_RULES §4, §11).
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
})

// Процент по дисциплине: среднее (score/maxScore) по колонкам с баллом.
function coursePercent(c: MyGradesCourse): number | null {
  const scored = c.columns
    .filter((col) => col.maxScore != null && col.score != null)
    .map((col) => (col.score as number) / (col.maxScore as number))
  if (scored.length === 0) return null
  return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
}

function toneClass(pct: number): string {
  return pct >= 75 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-destructive'
}

// «Академический профиль» студента (задача 12): сводка успеваемости — средний балл,
// посещаемость, набранные кредиты, статус — из /gradebook/me, /attendance/me, /auth/me.
export function AcademicView() {
  const t = useTranslations('Academic')

  const { palette } = useChartTheme()

  const meQ = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const gradesQ = useQuery({ queryKey: gradebookKeys.me(), queryFn: () => fetchMyGrades() })
  const attQ = useQuery({ queryKey: attendanceKeys.me(), queryFn: () => fetchMyAttendance() })
  // Сессия и задания — те же эндпоинты, что и на своих экранах; здесь из них нужны
  // только счётчики, и сводку они не блокируют (в `loading` не участвуют).
  const examsQ = useQuery({ queryKey: examKeys.list(), queryFn: () => fetchExams(), retry: false })
  const asgQ = useQuery({
    queryKey: assignmentKeys.list(),
    queryFn: () => fetchAssignments(),
    retry: false,
  })

  const gpa = useMemo(() => {
    const courses = gradesQ.data ?? []
    let weightSum = 0
    let acc = 0
    for (const c of courses) {
      const pct = coursePercent(c)
      if (pct === null) continue
      const w = c.credits ?? 1
      acc += pct * w
      weightSum += w
    }
    return weightSum === 0 ? null : Math.round(acc / weightSum)
  }, [gradesQ.data])

  const credits = useMemo(
    () =>
      (gradesQ.data ?? []).reduce(
        (n, c) => n + (coursePercent(c) !== null ? (c.credits ?? 0) : 0),
        0,
      ),
    [gradesQ.data],
  )

  const totalCredits = useMemo(
    () => (gradesQ.data ?? []).reduce((n, c) => n + (c.credits ?? 0), 0),
    [gradesQ.data],
  )

  // Проценты по дисциплинам для графика: худшие сверху — туда и надо смотреть.
  const bySubject = useMemo(() => {
    const rows = (gradesQ.data ?? [])
      .map((c) => ({ label: c.subject.name, value: coursePercent(c) }))
      .filter((r): r is { label: string; value: number } => r.value !== null)
    return rows.sort((a, b) => a.value - b.value)
  }, [gradesQ.data])

  const session = useMemo(() => {
    const exams = examsQ.data ?? []
    const now = Date.now()
    const statuses = (asgQ.data ?? []).map((a) => studentAssignmentStatus(a))
    return {
      examsPassed: exams.filter((e) => e.myResult?.status === 'PASSED').length,
      examsUpcoming: exams.filter((e) => new Date(e.date).getTime() >= now).length,
      submitted: statuses.filter((st) => st === 'SUBMITTED').length,
      overdue: statuses.filter((st) => st === 'OVERDUE').length,
    }
  }, [examsQ.data, asgQ.data])

  const att = attQ.data
  const rate = att?.rate ?? null
  const loading = meQ.isLoading || gradesQ.isLoading || attQ.isLoading

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricTile
              index={0}
              icon={TrendingUp}
              label={t('gpa')}
              value={gpa === null ? null : `${gpa}%`}
              progress={gpa}
              progressTone={gpa === null ? undefined : toneClass(gpa)}
            />
            <MetricTile
              index={1}
              icon={ClipboardCheck}
              tone="text-info"
              label={t('attendance')}
              value={rate === null ? null : `${rate}%`}
              progress={rate}
              progressTone={rate === null ? undefined : toneClass(rate)}
            />
            <MetricTile
              index={2}
              icon={Milestone}
              tone="text-warning"
              label={t('credits')}
              value={`${credits}${totalCredits ? ` / ${totalCredits}` : ''}`}
              progress={totalCredits ? Math.round((credits / totalCredits) * 100) : null}
            />
            <MetricTile
              index={3}
              icon={GraduationCap}
              tone="text-success"
              label={
                meQ.data?.enrollmentYear
                  ? `${t('status')} · ${t('since')} ${meQ.data.enrollmentYear}`
                  : t('status')
              }
              value={meQ.data?.academicStatus ?? t('statusActive')}
            />
          </div>

          {/* Успеваемость по дисциплинам: средний процент каждой — видно, где проседает,
              не заходя в журнал оценок. */}
          <SectionPanel title={t('bySubject')} subtitle={t('bySubjectHint')}>
            {bySubject.length === 0 ? (
              <EmptyState title={t('noGrades')} className="border-0 p-6" />
            ) : (
              <BarChart
                ariaLabel={t('bySubject')}
                palette={palette}
                height={Math.max(180, bySubject.length * 30 + 40)}
                labels={bySubject.map((r) => r.label)}
                values={bySubject.map((r) => r.value)}
                seriesName={t('percentShort')}
                valueLabel={(v) => `${v}%`}
              />
            )}
          </SectionPanel>

          {/* Разбивка посещаемости: плитка выше отвечает «сколько», эти четыре числа —
              «из чего процент сложился». */}
          {att && (
            <SectionPanel
              title={t('attendanceBreakdown')}
              subtitle={t('attendanceBreakdownHint')}
              bodyClassName="p-3"
            >
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricTile
                  index={0}
                  icon={Check}
                  tone="text-success"
                  label={t('present')}
                  value={att.present}
                />
                <MetricTile
                  index={1}
                  icon={Clock}
                  tone="text-warning"
                  label={t('late')}
                  value={att.late}
                />
                <MetricTile
                  index={2}
                  icon={X}
                  tone="text-destructive"
                  label={t('absent')}
                  value={att.absent}
                />
                <MetricTile
                  index={3}
                  icon={FileCheck2}
                  tone="text-info"
                  label={t('excused')}
                  value={att.excused}
                />
              </div>
            </SectionPanel>
          )}

          {/* Сессия и задания: что закрыто и что ещё висит. */}
          <SectionPanel title={t('sessionTitle')} subtitle={t('sessionHint')} bodyClassName="p-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricTile
                index={0}
                icon={Award}
                tone="text-success"
                label={t('examsPassed')}
                value={session.examsPassed}
              />
              <MetricTile
                index={1}
                icon={GraduationCap}
                tone="text-info"
                label={t('examsUpcoming')}
                value={session.examsUpcoming}
              />
              <MetricTile
                index={2}
                icon={Send}
                label={t('assignmentsSubmitted')}
                value={session.submitted}
              />
              <MetricTile
                index={3}
                icon={TriangleAlert}
                tone="text-destructive"
                label={t('assignmentsOverdue')}
                value={session.overdue}
              />
            </div>
          </SectionPanel>
        </>
      )}
    </div>
  )
}
