import type { Pair, PairTeacher } from '../../../entities/schedule'
import type { Material } from '../../../entities/material'
import type { CourseItem } from '../../../entities/course'
import { isoWeekParity, type NowInTz } from '../../../shared/lib'

// «Дисциплины» без отдельной модели: агрегируем из существующих данных (пары
// расписания + материалы). Дисциплина = уникальный `subject` группы. Со своим
// backend-доменом (Subject/Course, см. docs/ACADEMIC_CORE.md) перейдём на API,
// сохранив тот же контракт компонентов.

export interface CourseNextLesson {
  inDays: number // 0 = сегодня
  dayOfWeek: number
  startTime: string
  room: string | null
}

export interface CourseSummary {
  // slug = subject (кодируется в URL).
  subject: string
  teachers: PairTeacher[]
  lessonsPerWeek: number
  materialsCount: number
  next: CourseNextLesson | null
  // Данные из backend-домена (когда миграция применена): id курса, кредиты, семестр.
  courseId: string | null
  credits: number | null
  termName: string | null
}

function dowOf(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

// Ближайшее занятие дисциплины за 14 дней вперёд.
function nextLessonFor(subjectPairs: Pair[], now: NowInTz): CourseNextLesson | null {
  const base = new Date(`${now.date}T00:00:00`)
  for (let offset = 0; offset < 14; offset++) {
    const day = new Date(base)
    day.setDate(base.getDate() + offset)
    const dow = dowOf(day)
    const parity = isoWeekParity(day)
    const candidates = subjectPairs
      .filter((p) => p.dayOfWeek === dow && (p.weekType === 'BOTH' || p.weekType === parity))
      .filter((p) => offset > 0 || p.startTime > now.time)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
    const first = candidates[0]
    if (first) {
      return {
        inDays: offset,
        dayOfWeek: dow,
        startTime: first.startTime,
        room: first.room?.name ?? null,
      }
    }
  }
  return null
}

export function buildCourses(pairs: Pair[], materials: Material[], now: NowInTz): CourseSummary[] {
  const bySubject = new Map<string, Pair[]>()
  for (const p of pairs) {
    const list = bySubject.get(p.subject) ?? []
    list.push(p)
    bySubject.set(p.subject, list)
  }

  const materialCount = new Map<string, number>()
  for (const m of materials) {
    if (!m.subject) continue
    materialCount.set(m.subject, (materialCount.get(m.subject) ?? 0) + 1)
  }

  const courses: CourseSummary[] = []
  for (const [subject, subjectPairs] of bySubject) {
    const teachers: PairTeacher[] = []
    const seen = new Set<string>()
    for (const p of subjectPairs) {
      if (p.teacher && !seen.has(p.teacher.id)) {
        seen.add(p.teacher.id)
        teachers.push(p.teacher)
      }
    }
    courses.push({
      subject,
      teachers,
      lessonsPerWeek: subjectPairs.length,
      materialsCount: materialCount.get(subject) ?? 0,
      next: nextLessonFor(subjectPairs, now),
      courseId: null,
      credits: null,
      termName: null,
    })
  }

  return courses.sort((a, b) => a.subject.localeCompare(b.subject))
}

// Накладывает backend-курсы (`GET /courses`) поверх агрегации: сопоставляет по имени
// дисциплины, добавляя courseId/кредиты/семестр/официального преподавателя; курсы без пар
// в расписании добавляются отдельными карточками. Пустой `apiCourses` → возвращаем базу как есть.
export function mergeApiCourses(base: CourseSummary[], apiCourses: CourseItem[]): CourseSummary[] {
  if (apiCourses.length === 0) return base
  const bySubject = new Map(base.map((c) => [c.subject, { ...c }]))

  for (const course of apiCourses) {
    const name = course.subject.name
    const existing = bySubject.get(name)
    const teacher = course.teacher
      ? [
          {
            id: course.teacher.id,
            firstName: course.teacher.firstName,
            lastName: course.teacher.lastName,
          },
        ]
      : []
    if (existing) {
      existing.courseId = course.id
      existing.credits = course.credits
      existing.termName = course.term?.name ?? null
      if (existing.teachers.length === 0 && teacher.length > 0) existing.teachers = teacher
    } else {
      bySubject.set(name, {
        subject: name,
        teachers: teacher,
        lessonsPerWeek: 0,
        materialsCount: 0,
        next: null,
        courseId: course.id,
        credits: course.credits,
        termName: course.term?.name ?? null,
      })
    }
  }

  return Array.from(bySubject.values()).sort((a, b) => a.subject.localeCompare(b.subject))
}
