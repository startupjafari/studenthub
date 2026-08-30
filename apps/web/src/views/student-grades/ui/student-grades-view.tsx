'use client'

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { GraduationCap, Inbox, Milestone, TrendingUp } from 'lucide-react'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  MetricTile,
  PageHeader,
  Progress,
  Skeleton,
} from '../../../shared/ui'
import { gradebookKeys, fetchMyGrades, type MyGradesCourse } from '../../../entities/gradebook'
import { useRealtimeEnvelope } from '../../../shared/realtime'

// Процент по дисциплине: среднее (score/maxScore) по колонкам с баллом. null — нет оценок.
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

// «Оценки» студента (задача 8): карточки дисциплин + общий балл. Только опубликованные оценки.
export function StudentGradesView() {
  const t = useTranslations('Grades')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: gradebookKeys.me(), queryFn: () => fetchMyGrades() })

  // Realtime: преподаватель опубликовал колонку с моей оценкой → обновляем «Оценки» без опроса.
  useRealtimeEnvelope(REALTIME_EVENTS.gradePublished, () => {
    void qc.invalidateQueries({ queryKey: gradebookKeys.me() })
  })

  const overall = useMemo(() => {
    const courses = q.data ?? []
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
  }, [q.data])

  const totalCredits = useMemo(
    () =>
      (q.data ?? []).reduce((n, c) => n + (coursePercent(c) !== null ? (c.credits ?? 0) : 0), 0),
    [q.data],
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={<GraduationCap />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          {/* Сводка — теми же плитками, что в академическом профиле и на дашбордах:
              шкала одна на всю платформу, а не своя на каждом экране. */}
          {overall !== null && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricTile
                icon={TrendingUp}
                label={t('overall')}
                value={`${overall}%`}
                progress={overall}
                progressTone={toneClass(overall)}
              />
              {totalCredits > 0 && (
                <MetricTile
                  icon={Milestone}
                  tone="text-warning"
                  label={t('credits')}
                  value={totalCredits}
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {(q.data ?? []).map((c) => {
              const pct = coursePercent(c)
              return (
                <Card key={c.courseId}>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-heading text-base font-semibold">
                          {c.subject.name}
                        </h3>
                        {c.credits != null && (
                          <span className="text-xs text-muted-foreground">
                            {t('creditsN', { n: c.credits })}
                          </span>
                        )}
                      </div>
                      {pct !== null ? (
                        <span className="shrink-0 font-heading text-lg font-semibold tabular-nums">
                          {pct}%
                        </span>
                      ) : (
                        <Badge variant="secondary" className="shrink-0">
                          {t('noGrades')}
                        </Badge>
                      )}
                    </div>

                    {pct !== null && <Progress value={pct} indicatorClassName={toneClass(pct)} />}

                    {c.columns.length > 0 && (
                      <ul className="flex flex-col divide-y divide-border">
                        {c.columns.map((col) => (
                          <li
                            key={col.id}
                            className="flex items-center justify-between gap-3 py-1.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-sm">{col.title}</span>
                            <span className="shrink-0 text-sm font-medium tabular-nums">
                              {col.score != null ? col.score : '—'}
                              {col.maxScore != null && (
                                <span className="text-muted-foreground"> / {col.maxScore}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
