import type { UpdateCourseInput } from '@studenthub/shared-schemas'
import type { CourseItem } from '../../../entities/course'

// Значения формы правки курса: пустое поле — `null`, сервер такое значение снимает.
export interface CourseEditValues {
  teacherId: string | null
  termId: string | null
  credits: number | null
}

export function courseEditDefaults(course: CourseItem): CourseEditValues {
  return {
    teacherId: course.teacher?.id ?? null,
    termId: course.term?.id ?? null,
    credits: course.credits,
  }
}

/**
 * Тело PATCH /courses/:id — только изменённые поля. Отправлять всё подряд нельзя: сервер
 * заново проверяет каждого переданного преподавателя, и правка одних кредитов падала бы,
 * если ведущего курс тем временем заблокировали или удалили.
 */
export function buildCoursePatch(course: CourseItem, values: UpdateCourseInput): UpdateCourseInput {
  const before = courseEditDefaults(course)
  const after: CourseEditValues = {
    teacherId: values.teacherId ?? null,
    termId: values.termId ?? null,
    credits: values.credits ?? null,
  }
  const patch: UpdateCourseInput = {}
  if (after.teacherId !== before.teacherId) patch.teacherId = after.teacherId
  if (after.termId !== before.termId) patch.termId = after.termId
  if (after.credits !== before.credits) patch.credits = after.credits
  return patch
}

// Подпись преподавателя в пикере: фамилия первой — список упорядочен по ней.
export function teacherLabel(user: { firstName: string; lastName: string }): string {
  return `${user.lastName} ${user.firstName}`
}
