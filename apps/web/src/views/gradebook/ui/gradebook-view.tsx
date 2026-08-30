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

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          (courses.data ?? []).length > 0 && (
            <div className="w-60">
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger>
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
        }
      />

      {courses.isLoading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (courses.data ?? []).length === 0 ? (
        <EmptyState icon={<BookOpen />} title={t('noCourses')} description={t('noCoursesHint')} />
      ) : courseId ? (
        <GradebookTable courseId={courseId} />
      ) : null}
    </div>
  )
}
