'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  ArrowRight,
  Clock,
  Download,
  FileText,
  MapPin,
  MessagesSquare,
  Paperclip,
  User,
} from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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
import { groupKeys, fetchGroupMembers } from '../../../entities/group'
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
  const groupId = useAppSelector((s) => s.auth.groupId)

  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const materials = useQuery({ queryKey: materialKeys.list(), queryFn: () => fetchMaterials() })
  const members = useQuery({
    queryKey: groupKeys.members(groupId ?? ''),
    queryFn: () => fetchGroupMembers(groupId as string),
    enabled: !!groupId,
  })
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
      <div className="flex w-full flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/courses">{t('title')}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{subject}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader title={subject} />

      <Tabs defaultValue="overview">
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList>
            <TabsTrigger value="overview">{t('tab.overview')}</TabsTrigger>
            <TabsTrigger value="schedule">{t('tab.schedule')}</TabsTrigger>
            <TabsTrigger value="assignments">{t('tab.assignments')}</TabsTrigger>
            <TabsTrigger value="materials">{t('tab.materials')}</TabsTrigger>
            <TabsTrigger value="grades">{t('tab.grades')}</TabsTrigger>
            <TabsTrigger value="attendance">{t('tab.attendance')}</TabsTrigger>
            <TabsTrigger value="chat">{t('tab.chat')}</TabsTrigger>
            <TabsTrigger value="participants">{t('tab.participants')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <div className="flex flex-col gap-4">
            <Card>
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

            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-heading text-sm font-semibold">{t('recentMaterials')}</h3>
                {subjectMaterials.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noMaterials')}</p>
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
        </TabsContent>

        <TabsContent value="materials">
          {subjectMaterials.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title={t('noMaterials')}
              description={t('noMaterialsHint')}
            />
          ) : (
            <Card>
              <CardContent className="p-4">
                <ul className="flex flex-col gap-1.5">
                  {subjectMaterials.map((m) => (
                    <MaterialRow key={m.id} material={m} locale={locale} t={t} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="schedule">
          {subjectPairs.length === 0 ? (
            <EmptyState icon={<Clock />} title={t('noPairs')} />
          ) : (
            <Card>
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
        </TabsContent>

        <TabsContent value="assignments">
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
            <Card>
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
        </TabsContent>

        <TabsContent value="grades">
          {!gradesCourse || gradesCourse.columns.length === 0 ? (
            <EmptyState icon={<FileText />} title={t('noGrades')} />
          ) : (
            <Card>
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
        </TabsContent>

        <TabsContent value="attendance">
          {subjectAttendance.length === 0 ? (
            <EmptyState icon={<Clock />} title={t('noAttendanceData')} />
          ) : (
            <div className="flex flex-col gap-4">
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">{tAtt('overall')}</span>
                    <span className="font-heading text-2xl font-semibold tabular-nums">
                      {attStats.rate}%
                    </span>
                  </div>
                  <div className="flex gap-2 text-center text-xs">
                    <AttCell label={tAtt('status.present')} value={attStats.present} />
                    <AttCell label={tAtt('status.late')} value={attStats.late} />
                    <AttCell label={tAtt('status.absent')} value={attStats.absent} />
                    <AttCell label={tAtt('status.excused')} value={attStats.excused} />
                  </div>
                </CardContent>
              </Card>
              <Card>
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
        </TabsContent>

        <TabsContent value="chat">
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
        </TabsContent>

        <TabsContent value="participants">
          {!groupId ? (
            <EmptyState icon={<User />} title={t('noGroup')} />
          ) : members.isLoading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : (members.data ?? []).length === 0 ? (
            <EmptyState icon={<User />} title={t('noParticipants')} />
          ) : (
            <Card>
              <CardContent className="p-2">
                <ul className="divide-y divide-border">
                  {(members.data ?? []).map((mem) => (
                    <li key={mem.id} className="flex items-center gap-3 p-2.5">
                      <Avatar>
                        <AvatarImage src={mem.avatarUrl ?? undefined} alt="" />
                        <AvatarFallback>
                          {mem.firstName[0]}
                          {mem.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {mem.firstName} {mem.lastName}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
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

function AttCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border px-2 py-1">
      <div className="font-heading text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[0.65rem] text-muted-foreground">{label}</div>
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
    <li className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{material.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {material.teacher.firstName} {material.teacher.lastName} · {date}
          </p>
        </div>
      </div>
      {(material.media.length > 0 || material.url) && (
        <div className="flex flex-wrap gap-1.5 pl-6">
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
