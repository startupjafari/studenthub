'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { BookOpen, CalendarRange, Clock, FolderOpen, Inbox, MapPin, User } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { nowInTz } from '../../../shared/lib'
import { scheduleKeys, fetchSchedule } from '../../../entities/schedule'
import { materialKeys, fetchMaterials, fetchMaterialSubjects } from '../../../entities/material'
import { courseKeys, fetchCourses } from '../../../entities/course'
import { buildCourses, mergeApiCourses, type CourseNextLesson } from '../lib/build-courses'
import { MaterialRow } from './material-row'

// «Дисциплины» студента — единое пространство каждого предмета (задача 2).
export function CoursesView() {
  const t = useTranslations('Courses')
  const locale = useLocale()

  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  // Свежие материалы — только для «Прочих» ниже; счётчики на карточках считает сервер по всей
  // выборке, иначе они занижались, как только материалов становилось больше одной страницы.
  const materials = useQuery({ queryKey: materialKeys.list(), queryFn: () => fetchMaterials() })
  const materialCounts = useQuery({
    queryKey: materialKeys.subjects(),
    queryFn: () => fetchMaterialSubjects(),
  })
  // Backend-домен «Дисциплины»: до применения миграции эндпоинт может быть недоступен —
  // не ретраим и мягко откатываемся на агрегацию из расписания/материалов.
  const apiCourses = useQuery({
    queryKey: courseKeys.list(),
    queryFn: () => fetchCourses(),
    retry: false,
  })

  const courses = useMemo(() => {
    if (!schedule.data) return []
    const now = nowInTz(schedule.data.timezone ?? null)
    const base = buildCourses(schedule.data.pairs, materialCounts.data ?? [], now)
    return mergeApiCourses(base, apiCourses.data ?? [])
  }, [schedule.data, materialCounts.data, apiCourses.data])

  // Материалы, которые не попали ни в одну дисциплину: без предмета или с предметом, которого
  // нет в расписании студента. Во вкладке дисциплины их не найти — показываем здесь, иначе
  // студент не увидел бы их нигде.
  const otherMaterials = useMemo(() => {
    // Пока расписание не пришло, дисциплин ещё нет — «прочими» оказались бы все материалы.
    if (!schedule.data) return []
    const subjects = new Set(courses.map((c) => c.subject))
    return (materials.data ?? []).filter((m) => !m.subject || !subjects.has(m.subject))
  }, [schedule.data, courses, materials.data])

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} />

      {schedule.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : schedule.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => schedule.refetch()}>{t('retry')}</Button>}
        />
      ) : courses.length === 0 ? (
        <EmptyState icon={<BookOpen />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {courses.map((c) => (
            <Link key={c.subject} href={`/courses/${encodeURIComponent(c.subject)}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <BookOpen className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-heading text-base font-semibold">{c.subject}</h3>
                      {c.teachers.length > 0 && (
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <User className="size-3" aria-hidden />
                          {c.teachers.map((tt) => `${tt.firstName} ${tt.lastName}`).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
                    {c.next && <NextLessonBadge next={c.next} locale={locale} t={t} />}
                    {c.credits != null && (
                      <Badge variant="outline">{t('creditsCount', { count: c.credits })}</Badge>
                    )}
                    {c.termName && (
                      <Badge variant="secondary" className="gap-1">
                        <CalendarRange className="size-3" aria-hidden />
                        {c.termName}
                      </Badge>
                    )}
                    {c.materialsCount > 0 && (
                      <Badge variant="secondary" className="gap-1">
                        <FolderOpen className="size-3" aria-hidden />
                        {t('materialsCount', { count: c.materialsCount })}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {otherMaterials.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-heading text-base font-semibold">{t('otherMaterials')}</h2>
          <Card className="py-0">
            <CardContent className="p-4">
              <ul className="flex flex-col gap-1.5">
                {otherMaterials.map((m) => (
                  <MaterialRow key={m.id} material={m} locale={locale} t={t} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  )
}

function NextLessonBadge({
  next,
  locale,
  t,
}: {
  next: CourseNextLesson
  locale: string
  t: ReturnType<typeof useTranslations>
}) {
  const base = new Date()
  base.setDate(base.getDate() + next.inDays)
  const when =
    next.inDays === 0
      ? t('today')
      : next.inDays === 1
        ? t('tomorrow')
        : base.toLocaleDateString(locale, { weekday: 'short' })
  return (
    <Badge variant="info" className="gap-1">
      <Clock className="size-3" aria-hidden />
      {when} {next.startTime}
      {next.room ? (
        <>
          {' · '}
          <MapPin className="size-3" aria-hidden />
          {next.room}
        </>
      ) : null}
    </Badge>
  )
}
