'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Clock, Download, FileText, MapPin, Paperclip, User } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
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
import { buildCourses, mergeApiCourses } from '../lib/build-courses'

interface CourseViewProps {
  subject: string
}

// Course Workspace дисциплины (задача 2). Вкладки, доступные на текущих данных:
// Обзор, Материалы, Участники. Задания/Оценки/Посещаемость появятся со своими доменами.
export function CourseView({ subject }: CourseViewProps) {
  const t = useTranslations('Courses')
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
        <TabsList>
          <TabsTrigger value="overview">{t('tab.overview')}</TabsTrigger>
          <TabsTrigger value="materials">{t('tab.materials')}</TabsTrigger>
          <TabsTrigger value="participants">{t('tab.participants')}</TabsTrigger>
        </TabsList>

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
            <Button asChild variant="outline" size="xs" className="gap-1">
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
              size="xs"
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
