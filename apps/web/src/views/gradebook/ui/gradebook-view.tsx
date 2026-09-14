'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BookOpen } from 'lucide-react'
import {
  EmptyState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { courseKeys, fetchCourses } from '../../../entities/course'
import { GradebookTable } from './gradebook-table'

// «Журнал оценок» преподавателя (задача 7): выбор дисциплины → матрица оценок.
//
// Шапку страницы рисует `GradebookTable`, когда дисциплина выбрана: рядом с выбором
// дисциплины в шапке стоят «Добавить» и «Сохранить», а они живут внутри журнала
// (черновик оценок, список «грязных» колонок). Управление списком — в шапке, а не
// отдельной строкой над таблицей (§10.1).
export function GradebookView() {
  const t = useTranslations('Gradebook')
  const courses = useQuery({
    queryKey: courseKeys.list({ mine: true }),
    queryFn: () => fetchCourses({ mine: true }),
    retry: false,
  })
  const [courseId, setCourseId] = useState('')

  useEffect(() => {
    if (!courseId && courses.data && courses.data.length > 0) setCourseId(courses.data[0]!.id)
  }, [courses.data, courseId])

  const courseSelect = (
    <div className="w-60">
      <Select value={courseId} onValueChange={setCourseId}>
        {/* `md` — одна высота с кнопками «Добавить» и «Сохранить» рядом в шапке. */}
        <SelectTrigger size="md">
          <SelectValue placeholder={t('selectCourse')} />
        </SelectTrigger>
        <SelectContent>
          {(courses.data ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.subject.name} · {c.group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  if (courseId) return <GradebookTable courseId={courseId} courseSelect={courseSelect} />

  const hasCourses = (courses.data ?? []).length > 0

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} actions={hasCourses ? courseSelect : undefined} />
      {/* Дисциплины есть, но `courseId` ещё не проставлен эффектом — это тот же кадр
          загрузки, а не «нет дисциплин»: иначе на мгновение мигало бы пустое состояние. */}
      {courses.isLoading || hasCourses ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <EmptyState icon={<BookOpen />} title={t('noCourses')} description={t('noCoursesHint')} />
      )}
    </div>
  )
}
