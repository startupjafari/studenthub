'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { GraduationCap, Inbox, Milestone, TrendingUp } from 'lucide-react'
import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricTile,
  Modal,
  PageHeader,
  Progress,
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

// Тот же порог цветом текста: в таблице полоса прогресса на каждой строке была бы шумом.
function textToneClass(pct: number): string {
  return pct >= 75 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-destructive'
}

// Дисциплина · кредиты · работ · результат.
const COLS = ['46%', '8rem', '7rem', '9rem'] as const
// До `md` остаются дисциплина и результат — по ним оценки и смотрят.
const COLS_NARROW = ['62%', '0', '0', '38%'] as const
const HIDE = {
  credits: 'hidden md:table-cell',
  works: 'hidden lg:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [undefined, HIDE.credits, HIDE.works, undefined]

// «Оценки» студента (задача 8): сводка плитками, таблица дисциплин с сортировкой на
// клиенте и разбор по работам в модальном окне — как на «Учебном плане» и «Заявках».
export function StudentGradesView() {
  const t = useTranslations('Grades')
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useQuery({ queryKey: gradebookKeys.me(), queryFn: () => fetchMyGrades() })

  // Realtime: преподаватель опубликовал колонку с моей оценкой → обновляем «Оценки» без опроса.
  useRealtimeEnvelope(REALTIME_EVENTS.gradePublished, () => {
    void qc.invalidateQueries({ queryKey: gradebookKeys.me() })
  })

  const courses = useMemo(() => q.data ?? [], [q.data])

  const overall = useMemo(() => {
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
  }, [courses])

  const totalCredits = useMemo(
    () => courses.reduce((n, c) => n + (coursePercent(c) !== null ? (c.credits ?? 0) : 0), 0),
    [courses],
  )

  // Сортировка клиентская: журнал приходит одним запросом, серверу пересортировывать нечего.
  const sortValue = useCallback((c: MyGradesCourse, key: string) => {
    switch (key) {
      case 'credits':
        return c.credits
      case 'works':
        return c.columns.length
      case 'pct':
        return coursePercent(c)
      default:
        return c.subject.name
    }
  }, [])
  // Без начальной сортировки: порядок задаёт сервер.
  const { rows, sort, toggle } = useTableSort(courses, sortValue)

  const openCourse = courses.find((c) => c.courseId === openId) ?? null

  return (
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader title={t('title')} />

        {q.isError ? (
          <EmptyState
            icon={<Inbox />}
            title={t('loadError')}
            action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
          />
        ) : !q.isLoading && courses.length === 0 ? (
          <EmptyState icon={<GraduationCap />} title={t('empty')} description={t('emptyHint')} />
        ) : (
          <>
            {/* Сводка — теми же плитками, что в академическом профиле и на дашбордах:
                шкала одна на всю платформу, а не своя на каждом экране. */}
            {overall !== null && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MetricTile
                  index={0}
                  icon={TrendingUp}
                  label={t('overall')}
                  value={`${overall}%`}
                  progress={overall}
                  progressTone={toneClass(overall)}
                />
                {totalCredits > 0 && (
                  <MetricTile
                    index={1}
                    icon={Milestone}
                    tone="text-warning"
                    label={t('credits')}
                    value={totalCredits}
                  />
                )}
              </div>
            )}

            {/* `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой
                таблицы и просвет под последней строкой. */}
            <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
              <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
                <TableHeader>
                  <TableRow>
                    <TableHead sortKey="subject" sort={sort} onSort={toggle}>
                      {t('colSubject')}
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
                    <TableHead
                      numeric
                      sortKey="works"
                      sort={sort}
                      onSort={toggle}
                      className={HIDE.works}
                    >
                      {t('colWorks')}
                    </TableHead>
                    <TableHead numeric sortKey="pct" sort={sort} onSort={toggle}>
                      {t('colResult')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
                  {rows.map((c) => {
                    const pct = coursePercent(c)
                    return (
                      <TableRow
                        key={c.courseId}
                        tabIndex={0}
                        aria-haspopup="dialog"
                        onClick={() => setOpenId(c.courseId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setOpenId(c.courseId)
                          }
                        }}
                        className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                      >
                        <TableCell className="font-medium">
                          <TableText value={c.subject.name} />
                        </TableCell>
                        <TableCell className={cn(HIDE.credits, 'text-right tabular-nums')}>
                          {c.credits ?? <TableEmpty />}
                        </TableCell>
                        <TableCell
                          className={cn(
                            HIDE.works,
                            'text-right text-muted-foreground tabular-nums',
                          )}
                        >
                          {c.columns.length}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {pct !== null ? (
                            <span className={textToneClass(pct)}>{pct}%</span>
                          ) : (
                            <Badge variant="secondary">{t('noGrades')}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </div>

      {/* Разбор по работам — в окне: в строке таблицы ему места нет, а разворачивать
          список прямо в ней значило бы ломать сетку колонок. */}
      {openCourse && (
        <Modal onClose={() => setOpenId(null)} title={openCourse.subject.name} size="lg">
          <CourseBreakdown course={openCourse} t={t} />
        </Modal>
      )}
    </>
  )
}

function CourseBreakdown({
  course: c,
  t,
}: {
  course: MyGradesCourse
  t: ReturnType<typeof useTranslations>
}) {
  const pct = coursePercent(c)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {c.credits != null ? t('creditsN', { n: c.credits }) : ''}
        </span>
        {pct !== null ? (
          <span className="font-heading text-lg font-semibold tabular-nums">{pct}%</span>
        ) : (
          <Badge variant="secondary">{t('noGrades')}</Badge>
        )}
      </div>

      {pct !== null && <Progress value={pct} indicatorClassName={toneClass(pct)} />}

      {c.columns.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {c.columns.map((col) => (
            <li key={col.id} className="flex items-center justify-between gap-3 py-2">
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
    </div>
  )
}
