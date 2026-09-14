'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  Clock,
  Download,
  FileCheck2,
  FileText,
  MapPin,
  MessagesSquare,
  Paperclip,
  User,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  MetricTile,
  PageHeader,
  SegmentedTabs,
  Skeleton,
} from '../../../shared/ui'
import { nowInTz } from '../../../shared/lib'
import { useAppSelector } from '../../../shared/store'
import { scheduleKeys, fetchSchedule } from '../../../entities/schedule'
import {
  materialKeys,
  fetchMaterials,
  fetchMaterialFileUrl,
  type Material,
} from '../../../entities/material'
import { GroupMembers } from '../../../widgets/group-members'
import { cn } from '../../../shared/lib/utils'
import { courseKeys, fetchCourses } from '../../../entities/course'
import {
  assignmentKeys,
  fetchAssignments,
  studentAssignmentStatus,
  type StudentAssignmentStatus,
} from '../../../entities/assignment'
import { gradebookKeys, fetchMyGrades } from '../../../entities/gradebook'
import { attendanceKeys, fetchMyAttendance } from '../../../entities/attendance'
import { buildCourses, mergeApiCourses } from '../lib/build-courses'

// Статус задания глазами студента → вариант бейджа + i18n-ключ (namespace Assignments.status).
const ASG_STATUS_KEY: Record<StudentAssignmentStatus, string> = {
  NOT_STARTED: 'notStarted',
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  GRADED: 'graded',
  RETURNED: 'returned',
  OVERDUE: 'overdue',
}
const ASG_STATUS_VARIANT: Record<
  StudentAssignmentStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  NOT_STARTED: 'outline',
  DRAFT: 'outline',
  SUBMITTED: 'secondary',
  GRADED: 'default',
  RETURNED: 'destructive',
  OVERDUE: 'destructive',
}

// Разделы дисциплины. Живут в шапке страницы (SegmentedTabs), как на остальных экранах
// со вкладками: очередь деканата, заявки, экзамены.
type TabId =
  | 'overview'
  | 'schedule'
  | 'assignments'
  | 'materials'
  | 'grades'
  | 'attendance'
  | 'chat'
  | 'participants'
const TAB_ORDER: TabId[] = [
  'overview',
  'schedule',
  'assignments',
  'materials',
  'grades',
  'attendance',
  'chat',
  'participants',
]
// Явная карта подписей, а не собранный ключ `tab.${id}`: построенный ключ не видит ни
// компилятор, ни тест словарей (FRONTEND_RULES §10).
const TAB_LABEL: Record<TabId, string> = {
  overview: 'tab.overview',
  schedule: 'tab.schedule',
  assignments: 'tab.assignments',
  materials: 'tab.materials',
  grades: 'tab.grades',
  attendance: 'tab.attendance',
  chat: 'tab.chat',
  participants: 'tab.participants',
}

// Название дня недели по ISO dow (1..7). 2024-01-01 — понедельник.
function weekdayName(dow: number, locale: string): string {
  return new Date(2024, 0, dow).toLocaleDateString(locale, { weekday: 'short' })
}

interface CourseViewProps {
  subject: string
}

// Course Workspace дисциплины (задача 2). Вкладки, доступные на текущих данных:
// Обзор, Материалы, Участники. Задания/Оценки/Посещаемость появятся со своими доменами.
export function CourseView({ subject }: CourseViewProps) {
  const t = useTranslations('Courses')
  const tA = useTranslations('Assignments')
  const tAtt = useTranslations('Attendance')
  const locale = useLocale()
  const router = useRouter()
  const groupId = useAppSelector((s) => s.auth.groupId)
  const [tab, setTab] = useState<TabId>('overview')

  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const materials = useQuery({ queryKey: materialKeys.list(), queryFn: () => fetchMaterials() })
  const apiCourses = useQuery({
    queryKey: courseKeys.list(),
    queryFn: () => fetchCourses(),
    retry: false,
  })

  const summary = useMemo(() => {
    if (!schedule.data) return null
    const now = nowInTz(schedule.data.timezone ?? null)
    const base = buildCourses(schedule.data.pairs, materials.data ?? [], now)
    return mergeApiCourses(base, apiCourses.data ?? []).find((c) => c.subject === subject)
  }, [schedule.data, materials.data, apiCourses.data, subject])

  const subjectMaterials = useMemo(
    () => (materials.data ?? []).filter((m) => m.subject === subject),
    [materials.data, subject],
  )

  // Workspace дисциплины (docs/UNIFIED_UX.md PR-3): единая дисциплина = расписание +
  // задания + материалы + оценки + посещаемость + чат. Всё из существующих сущностей.
  const myGrades = useQuery({ queryKey: gradebookKeys.me(), queryFn: fetchMyGrades, retry: false })
  const myAttendance = useQuery({
    queryKey: attendanceKeys.me(),
    queryFn: () => fetchMyAttendance(),
    retry: false,
  })

  const gradesCourse = useMemo(
    () => (myGrades.data ?? []).find((c) => c.subject.name === subject) ?? null,
    [myGrades.data, subject],
  )
  // id курса из backend-домена (когда миграция применена): из обзора или из «моих оценок».
  const courseId = summary?.courseId ?? gradesCourse?.courseId ?? null

  const assignments = useQuery({
    queryKey: assignmentKeys.list({ courseId: courseId ?? undefined }),
    queryFn: () => fetchAssignments({ courseId: courseId ?? undefined }),
    enabled: !!courseId,
    retry: false,
  })

  const subjectPairs = useMemo(
    () =>
      (schedule.data?.pairs ?? [])
        .filter((p) => p.subject === subject)
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
    [schedule.data?.pairs, subject],
  )

  const subjectAttendance = useMemo(
    () => (myAttendance.data?.records ?? []).filter((r) => r.pair.subject === subject),
    [myAttendance.data, subject],
  )
  const attStats = useMemo(() => {
    const s = { present: 0, late: 0, absent: 0, excused: 0 }
    for (const r of subjectAttendance) {
      const k = r.status.toLowerCase() as keyof typeof s
      if (k in s) s[k] += 1
    }
    const total = subjectAttendance.length
    const rate = total ? Math.round(((s.present + s.late) / total) * 100) : 0
    return { ...s, total, rate }
  }, [subjectAttendance])

  // Средний процент по опубликованным оценкам дисциплины.
  const gradesAverage = useMemo(() => {
    const cols = (gradesCourse?.columns ?? []).filter((c) => c.score != null && c.maxScore)
    if (cols.length === 0) return null
    const pct =
      cols.reduce((a, c) => a + (c.score as number) / (c.maxScore as number), 0) / cols.length
    return Math.round(pct * 100)
  }, [gradesCourse])

  if (schedule.isLoading) {
    return (
      <div className="flex w-full flex-1 flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  return (
    // `min-h-0` только на вкладке участников: там таблица растягивается на всю высоту и
    // прокручивается сама (`GroupMembers fill`). Остальным вкладкам он вреден — их
    // содержимое длиннее экрана и прокручивается страницей, а с `min-h-0` колонка
    // ужалась бы до высоты `main` и хвост уехал бы за нижнюю границу.
    <div className={cn('flex w-full flex-1 flex-col gap-4', tab === 'participants' && 'min-h-0')}>
      <PageHeader
        title={subject}
        // Возврат к списку дисциплин — стрелкой в шапке, как на других вложенных
        // экранах (заявка, задание): крошки над шапкой дублировали заголовок и
        // уезжали под верхний край.
        onBack={() => router.push('/courses')}
        backLabel={t('title')}
        tabs={
          <SegmentedTabs
            aria-label={subject}
            value={tab}
            onChange={setTab}
            items={TAB_ORDER.map((id) => ({ value: id, label: t(TAB_LABEL[id]) }))}
          />
        }
      />

      {tab === 'overview' && (
        <>
          <div className="flex flex-col gap-4">
            <Card className="py-0">
              <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
                <Info label={t('teacher')}>
                  {summary && summary.teachers.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <User className="size-4 text-muted-foreground" aria-hidden />
                      {summary.teachers.map((tt) => `${tt.firstName} ${tt.lastName}`).join(', ')}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </Info>
                <Info label={t('lessonsPerWeek')}>
                  <span className="text-sm">{summary?.lessonsPerWeek ?? 0}</span>
                </Info>
                {summary?.credits != null && (
                  <Info label={t('credits')}>
                    <span className="text-sm">{summary.credits}</span>
                  </Info>
                )}
                {summary?.termName && (
                  <Info label={t('term')}>
                    <span className="text-sm">{summary.termName}</span>
                  </Info>
                )}
                <Info label={t('nextLesson')}>
                  {summary?.next ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Clock className="size-4 text-muted-foreground" aria-hidden />
                      {summary.next.inDays === 0
                        ? t('today')
                        : summary.next.inDays === 1
                          ? t('tomorrow')
                          : new Date(
                              Date.now() + summary.next.inDays * 86400000,
                            ).toLocaleDateString(locale, { weekday: 'short' })}{' '}
                      {summary.next.startTime}
                      {summary.next.room ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden />
                          {summary.next.room}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </Info>
              </CardContent>
            </Card>

            <Card className="py-0">
              <CardContent className="p-4">
                <h3 className="mb-3 font-heading text-sm font-semibold">{t('recentMaterials')}</h3>
                {subjectMaterials.length === 0 ? (
                  <EmptyState title={t('noMaterials')} className="border-0 p-6" />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {subjectMaterials.slice(0, 3).map((m) => (
                      <MaterialRow key={m.id} material={m} locale={locale} t={t} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {tab === 'materials' && (
        <>
          {subjectMaterials.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title={t('noMaterials')}
              description={t('noMaterialsHint')}
            />
          ) : (
            <Card className="py-0">
              <CardContent className="p-4">
                <ul className="flex flex-col gap-1.5">
                  {subjectMaterials.map((m) => (
                    <MaterialRow key={m.id} material={m} locale={locale} t={t} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === 'schedule' && (
        <>
          {subjectPairs.length === 0 ? (
            <EmptyState icon={<Clock />} title={t('noPairs')} />
          ) : (
            <Card className="py-0">
              <CardContent className="p-2">
                <ul className="divide-y divide-border">
                  {subjectPairs.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 p-2.5">
                      <span className="w-10 shrink-0 text-xs font-semibold uppercase text-muted-foreground">
                        {weekdayName(p.dayOfWeek, locale)}
                      </span>
                      <span className="w-24 shrink-0 text-sm tabular-nums">
                        {p.startTime}–{p.endTime}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {p.teacher ? `${p.teacher.firstName} ${p.teacher.lastName}` : '—'}
                      </span>
                      {p.room && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden />
                          {p.room.name}
                        </span>
                      )}
                      {p.weekType !== 'BOTH' && (
                        <Badge variant="outline" className="shrink-0">
                          {p.weekType === 'ODD' ? t('weekOdd') : t('weekEven')}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === 'assignments' && (
        <>
          {!courseId ? (
            <EmptyState
              icon={<FileText />}
              title={t('noCourseLink')}
              description={t('noCourseLinkHint')}
            />
          ) : assignments.isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (assignments.data ?? []).length === 0 ? (
            <EmptyState icon={<FileText />} title={t('noAssignments')} />
          ) : (
            <Card className="py-0">
              <CardContent className="p-2">
                <ul className="divide-y divide-border">
                  {(assignments.data ?? []).map((a) => {
                    const st = studentAssignmentStatus(a)
                    return (
                      <li key={a.id}>
                        <Link
                          href={`/assignments?open=${a.id}`}
                          className="flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{a.title}</p>
                            {a.dueAt && (
                              <p className="text-xs text-muted-foreground">
                                {new Date(a.dueAt).toLocaleDateString(locale, {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            )}
                          </div>
                          <Badge variant={ASG_STATUS_VARIANT[st]} className="shrink-0">
                            {tA(`status.${ASG_STATUS_KEY[st]}`)}
                          </Badge>
                          <ArrowRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === 'grades' && (
        <>
          {!gradesCourse || gradesCourse.columns.length === 0 ? (
            <EmptyState icon={<FileText />} title={t('noGrades')} />
          ) : (
            <Card className="py-0">
              <CardContent className="flex flex-col gap-3 p-4">
                {gradesAverage != null && (
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                    <span className="text-sm text-muted-foreground">{t('average')}</span>
                    <span className="font-heading text-lg font-semibold tabular-nums">
                      {gradesAverage}%
                    </span>
                  </div>
                )}
                <ul className="divide-y divide-border">
                  {gradesCourse.columns.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {c.score != null ? c.score : '—'}
                        {c.maxScore != null && (
                          <span className="text-muted-foreground"> / {c.maxScore}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === 'attendance' && (
        <>
          {subjectAttendance.length === 0 ? (
            <EmptyState icon={<Clock />} title={t('noAttendanceData')} />
          ) : (
            <div className="flex flex-col gap-4">
              {/* Те же плитки, что на «Посещаемости» и дашбордах — одна шкала. */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <MetricTile
                  index={0}
                  icon={CalendarCheck2}
                  label={tAtt('overall')}
                  value={`${attStats.rate}%`}
                  progress={attStats.rate}
                  progressTone={
                    attStats.rate >= 75
                      ? 'bg-success'
                      : attStats.rate >= 50
                        ? 'bg-warning'
                        : 'bg-destructive'
                  }
                />
                <MetricTile
                  index={1}
                  icon={Check}
                  tone="text-success"
                  label={tAtt('status.present')}
                  value={attStats.present}
                />
                <MetricTile
                  index={2}
                  icon={Clock}
                  tone="text-warning"
                  label={tAtt('status.late')}
                  value={attStats.late}
                />
                <MetricTile
                  index={3}
                  icon={X}
                  tone="text-destructive"
                  label={tAtt('status.absent')}
                  value={attStats.absent}
                />
                <MetricTile
                  index={4}
                  icon={FileCheck2}
                  tone="text-info"
                  label={tAtt('status.excused')}
                  value={attStats.excused}
                />
              </div>
              <Card className="py-0">
                <CardContent className="p-2">
                  <ul className="divide-y divide-border">
                    {subjectAttendance.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 p-2.5">
                        <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
                          {new Date(r.date).toLocaleDateString(locale, {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">{r.pair.startTime}</span>
                        <Badge
                          variant={
                            r.status === 'ABSENT'
                              ? 'destructive'
                              : r.status === 'PRESENT'
                                ? 'default'
                                : 'secondary'
                          }
                          className="shrink-0"
                        >
                          {tAtt(`status.${r.status.toLowerCase()}`)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {tab === 'chat' && (
        <>
          <EmptyState
            icon={<MessagesSquare />}
            title={t('chatTitle')}
            description={t('chatHint')}
            action={
              <Button asChild className="gap-1.5">
                <Link href="/chats">
                  {t('openChat')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            }
          />
        </>
      )}

      {/* Участники — тот же виджет, что на экранах «Моя группа» и «Одногруппники»:
          таблица с сортировкой по участнику и роли, ссылки на профили. Свой список
          дублировал его вёрстку и не показывал роль. */}
      {tab === 'participants' && <GroupMembers groupId={groupId} fill />}
    </div>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function MaterialRow({
  material,
  locale,
  t,
}: {
  material: Material
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const date = new Date(material.createdAt).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  })

  async function openFile(fileId: string) {
    setBusy(fileId)
    try {
      const url = await fetchMaterialFileUrl(material.id, fileId)
      window.open(url, '_blank', 'noopener')
    } finally {
      setBusy(null)
    }
  }

  return (
    // Одна строка: слева — что за материал, справа — чем его открыть. Раньше кнопки
    // стояли под названием с отступом слева, и строка выглядела ступенькой, а правая
    // половина карточки пустовала. На узком экране кнопки переносятся под текст.
    <li className="flex flex-col gap-2 rounded-lg border border-border p-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{material.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {material.teacher.firstName} {material.teacher.lastName} · {date}
          </p>
        </div>
      </div>
      {(material.media.length > 0 || material.url) && (
        <div className="flex flex-wrap gap-1.5 pl-6 sm:shrink-0 sm:justify-end sm:pl-0">
          {material.url && (
            <Button asChild variant="outline" size="sm" className="gap-1">
              <a href={material.url} target="_blank" rel="noopener noreferrer">
                <Paperclip className="size-3" aria-hidden />
                {t('link')}
              </a>
            </Button>
          )}
          {material.media.map((f, i) => (
            <Button
              key={f.id}
              variant="outline"
              size="sm"
              className="gap-1"
              loading={busy === f.id}
              onClick={() => openFile(f.id)}
            >
              <Download className="size-3" aria-hidden />
              {t('file', { n: i + 1 })}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}
