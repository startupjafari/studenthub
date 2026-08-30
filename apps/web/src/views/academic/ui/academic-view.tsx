'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Award,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Milestone,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { MetricTile, PageHeader, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { fetchMe, userKeys } from '../../../entities/user'
import { gradebookKeys, fetchMyGrades, type MyGradesCourse } from '../../../entities/gradebook'
import { attendanceKeys, fetchMyAttendance } from '../../../entities/attendance'

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

  const meQ = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const gradesQ = useQuery({ queryKey: gradebookKeys.me(), queryFn: () => fetchMyGrades() })
  const attQ = useQuery({ queryKey: attendanceKeys.me(), queryFn: () => fetchMyAttendance() })

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

  const rate = attQ.data?.rate ?? null
  const loading = meQ.isLoading || gradesQ.isLoading || attQ.isLoading

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
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
              icon={TrendingUp}
              label={t('gpa')}
              value={gpa === null ? null : `${gpa}%`}
              progress={gpa}
              progressTone={gpa === null ? undefined : toneClass(gpa)}
            />
            <MetricTile
              icon={ClipboardCheck}
              tone="text-info"
              label={t('attendance')}
              value={rate === null ? null : `${rate}%`}
              progress={rate}
              progressTone={rate === null ? undefined : toneClass(rate)}
            />
            <MetricTile
              icon={Milestone}
              tone="text-warning"
              label={t('credits')}
              value={`${credits}${totalCredits ? ` / ${totalCredits}` : ''}`}
              progress={totalCredits ? Math.round((credits / totalCredits) * 100) : null}
            />
            <MetricTile
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

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{t('sections')}</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <QuickLink href="/grades" icon={GraduationCap} label={t('linkGrades')} />
              <QuickLink href="/attendance" icon={ClipboardCheck} label={t('linkAttendance')} />
              <QuickLink href="/study-plan" icon={Milestone} label={t('linkStudyPlan')} />
              <QuickLink href="/exams" icon={Award} label={t('linkExams')} />
              <QuickLink href="/courses" icon={BookOpen} label={t('linkCourses')} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-sm font-medium transition-colors',
        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      {label}
    </Link>
  )
}
