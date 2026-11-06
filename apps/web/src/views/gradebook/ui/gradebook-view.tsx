'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BookOpen } from 'lucide-react'
import { EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { CourseSelect, courseKeys, fetchAllCourses } from '../../../entities/course'
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
    queryKey: courseKeys.listAll({ mine: true }),
    queryFn: () => fetchAllCourses({ mine: true }),
    retry: false,
  })
  const [courseId, setCourseId] = useState('')

  useEffect(() => {
    if (!courseId && courses.data && courses.data.length > 0) setCourseId(courses.data[0]!.id)
  }, [courses.data, courseId])

  const courseSelect = (
    <div className="w-60">
      {/* `md` — одна высота с кнопками «Добавить» и «Сохранить» рядом в шапке. Сброс
          выбора (крестик) журнал не закрывает: без дисциплины показывать нечего. */}
      <CourseSelect
        courses={courses.data ?? []}
        value={courseId}
        onChange={(next) => {
          if (next) setCourseId(next)
        }}
        loading={courses.isFetching}
        placeholder={t('selectCourse')}
        size="md"
      />
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
        <Skeleton fill className="min-h-80 rounded-xl" />
      ) : (
        <EmptyState icon={<BookOpen />} title={t('noCourses')} description={t('noCoursesHint')} />
      )}
    </div>
  )
}
