import type { Pair, PairTeacher } from '../../../entities/schedule'
import type { MaterialSubjectCount } from '../../../entities/material'
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
  // slug = subject (кодируется в URL); курс конкретного семестра — параметром `course`.
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

// `materialCounts` — счётчики с сервера (`GET /materials/subjects`): посчитанные по странице
// списка материалов, они занижались, как только материалов становилось больше страницы.
export function buildCourses(
  pairs: Pair[],
  materialCounts: MaterialSubjectCount[],
  now: NowInTz,
): CourseSummary[] {
  const bySubject = new Map<string, Pair[]>()
  for (const p of pairs) {
    const list = bySubject.get(p.subject) ?? []
    list.push(p)
    bySubject.set(p.subject, list)
  }

  const materialCount = new Map<string, number>()
  for (const c of materialCounts) {
    if (c.subject) materialCount.set(c.subject, c.count)
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

/**
 * Порядок курсов одной дисциплины: курс текущего семестра → без семестра → прочие,
 * свежие раньше. Первый в нём — «основной»: ему достаются пары расписания (у пары нет
 * ссылки на курс, только название), а значит и задания со страницы дисциплины.
 */
function courseRank(course: CourseItem): number {
  if (course.term?.isActive) return 0
  if (!course.term) return 1
  return 2
}

function compareCourses(a: CourseItem, b: CourseItem): number {
  return (
    courseRank(a) - courseRank(b) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  )
}

function courseTeachers(course: CourseItem): PairTeacher[] {
  return course.teacher
    ? [
        {
          id: course.teacher.id,
          firstName: course.teacher.firstName,
          lastName: course.teacher.lastName,
        },
      ]
    : []
}

function summaryOf(course: CourseItem): CourseSummary {
  return {
    subject: course.subject.name,
    teachers: courseTeachers(course),
    lessonsPerWeek: 0,
    materialsCount: 0,
    next: null,
    courseId: course.id,
    credits: course.credits,
    termName: course.term?.name ?? null,
  }
}

// Накладывает backend-курсы (`GET /courses`) поверх агрегации: основной курс дисциплины
// (см. `compareCourses`) дополняет карточку из расписания courseId/кредитами/семестром/
// официальным преподавателем. Остальные курсы с тем же названием (прошлые семестры) и курсы
// без пар в расписании — отдельными карточками: раньше карта по названию склеивала
// «Математику» 1-го и 2-го семестров в одну, и побеждал случайный курс (C-F25).
// Пустой `apiCourses` → возвращаем базу как есть.
export function mergeApiCourses(base: CourseSummary[], apiCourses: CourseItem[]): CourseSummary[] {
  if (apiCourses.length === 0) return base
  const byName = new Map<string, CourseItem[]>()
  for (const course of apiCourses) {
    const list = byName.get(course.subject.name) ?? []
    list.push(course)
    byName.set(course.subject.name, list)
  }

  const result: CourseSummary[] = []
  for (const card of base) {
    const [primary, ...rest] = (byName.get(card.subject) ?? []).sort(compareCourses)
    byName.delete(card.subject)
    if (!primary) {
      result.push(card)
      continue
    }
    result.push({
      ...card,
      courseId: primary.id,
      credits: primary.credits,
      termName: primary.term?.name ?? null,
      teachers: card.teachers.length > 0 ? card.teachers : courseTeachers(primary),
    })
    for (const course of rest) result.push(summaryOf(course))
  }
  for (const list of byName.values()) {
    for (const course of list.sort(compareCourses)) result.push(summaryOf(course))
  }

  // Сортировка устойчивая: внутри одной дисциплины основной курс остаётся первым.
  return result.sort((a, b) => a.subject.localeCompare(b.subject))
}

/** Ключ карточки: у курсов одной дисциплины разных семестров название одно. */
export function courseKey(course: CourseSummary): string {
  return course.courseId ?? `subject:${course.subject}`
}

/**
 * Ссылка на страницу дисциплины. Путь — по названию (так открываются и дисциплины без
 * курса, из одного расписания), курс уточняется параметром `course`.
 */
export function courseHref(course: CourseSummary): string {
  const path = `/courses/${encodeURIComponent(course.subject)}`
  return course.courseId ? `${path}?course=${encodeURIComponent(course.courseId)}` : path
}

/**
 * Карточка для страницы дисциплины: по id курса из ссылки, а без него (или если такого
 * курса нет) — основная карточка с этим названием.
 */
export function pickCourse(
  courses: CourseSummary[],
  subject: string,
  courseId: string | null,
): CourseSummary | undefined {
  const byId = courseId ? courses.find((c) => c.courseId === courseId) : undefined
  return byId ?? courses.find((c) => c.subject === subject)
}
