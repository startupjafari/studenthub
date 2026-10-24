import type { ExamResultStatus } from '@studenthub/shared-schemas'
import type { CourseItem } from '../model/types'

// Статус дисциплины в учебном плане — одно правило (C-F26) для «Учебного плана» и
// «Академической сводки»: раньше сводка засчитывала кредиты по первой же оценке (и по
// проваленным тоже) и расходилась с планом.

export type PlanStatus = 'completed' | 'studying' | 'upcoming' | 'notPassed' | 'noResult'

export const PASS_THRESHOLD = 50

// Опубликованная колонка журнала с баллом студента (как её отдаёт GET /gradebook/me).
export interface PlanGradeColumn {
  kind: string
  maxScore: number | null
  score: number | null
}

// Результат экзамена студента по дисциплине (`myResult` из GET /exams) с датой экзамена.
export interface PlanExamResult {
  date: string
  status: ExamResultStatus
}

/** Процент по набору колонок: среднее score/maxScore по колонкам с баллом и максимумом. */
export function gradePercent(columns: PlanGradeColumn[]): number | null {
  const scored = columns
    .filter((c) => c.maxScore != null && c.score != null)
    .map((c) => (c.score as number) / (c.maxScore as number))
  if (scored.length === 0) return null
  return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
}

// Семестр дисциплины: даты (ISO) — из GET /courses.
export interface PlanTerm {
  isActive: boolean
  startsOn?: string
  endsOn?: string
}

export type TermPhase = 'current' | 'past' | 'future'

/**
 * Где семестр относительно сегодняшней даты "YYYY-MM-DD" — по его датам, а не по одному
 * `isActive`: без активного семестра (каникулы, админ ещё не переключил) все семестры
 * выглядели прошедшими, и будущий с ранней оценкой становился «пройденным». Отмеченный
 * текущим семестр — текущий и после своей даты окончания (сессия может затянуться).
 */
export function termPhase(term: PlanTerm, today: string): TermPhase {
  if (term.isActive) return 'current'
  if (!term.startsOn || !term.endsOn) return 'past'
  if (today < term.startsOn.slice(0, 10)) return 'future'
  if (today > term.endsOn.slice(0, 10)) return 'past'
  return 'current'
}

/**
 * Статус дисциплины в учебном плане (C-F26).
 *
 * Раньше «Пройдена/Не сдана» ставилась по первой же опубликованной оценке — после первой
 * лабораторной на 6/10 дисциплина текущего семестра становилась пройденной и добавляла
 * кредиты в прогресс. Теперь итог подводится только у завершённой дисциплины:
 *  1) семестр идёт — «изучается», процент справочно; ещё не начался — «предстоит»;
 *  2) есть итог экзамена (последний по дате, не «назначен») — он и решает;
 *  3) есть оценённые колонки «Экзамен» — по ним;
 *  4) прошлый семестр — по всем опубликованным оценкам дисциплины, а не по первой;
 *     без оценок — «нет итога» (а не «предстоит»: семестр уже прошёл);
 *  5) без семестра оценки не говорят, кончилась ли дисциплина, — «изучается»,
 *     без оценок — «предстоит».
 */
export function planStatus(input: {
  term: PlanTerm | null
  today: string
  columns: PlanGradeColumn[]
  exams: PlanExamResult[]
}): PlanStatus {
  const phase = input.term ? termPhase(input.term, input.today) : null
  if (phase === 'current') return 'studying'
  if (phase === 'future') return 'upcoming'
  const final = [...input.exams]
    .filter((e) => e.status !== 'SCHEDULED')
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (final) return final.status === 'PASSED' ? 'completed' : 'notPassed'
  const examPct = gradePercent(input.columns.filter((c) => c.kind === 'EXAM'))
  if (examPct !== null) return examPct >= PASS_THRESHOLD ? 'completed' : 'notPassed'
  const pct = gradePercent(input.columns)
  if (phase === null) return pct === null ? 'upcoming' : 'studying'
  if (pct === null) return 'noResult'
  return pct >= PASS_THRESHOLD ? 'completed' : 'notPassed'
}

// Оценки студента по курсу (GET /gradebook/me) и его экзамены (GET /exams с `myResult`) —
// в том виде, в каком их отдают эти эндпоинты.
interface PlanGrades {
  courseId: string
  columns: PlanGradeColumn[]
}
interface PlanExam {
  date: string
  course: { id: string }
  myResult?: { status: ExamResultStatus } | null
}

export interface PlanEntry {
  course: CourseItem
  /** Процент — справочно по всем опубликованным оценкам; статус считается отдельно. */
  pct: number | null
  status: PlanStatus
}

/** Курсы плана с процентом и статусом на дату `today` ("YYYY-MM-DD"). */
export function buildPlan(
  courses: CourseItem[],
  grades: PlanGrades[],
  exams: PlanExam[],
  today: string,
): PlanEntry[] {
  const gradeByCourse = new Map(grades.map((g) => [g.courseId, g]))
  const examsByCourse = new Map<string, PlanExamResult[]>()
  for (const e of exams) {
    if (!e.myResult) continue
    const results = examsByCourse.get(e.course.id) ?? []
    results.push({ date: e.date, status: e.myResult.status })
    examsByCourse.set(e.course.id, results)
  }
  return courses.map((course) => {
    const columns = gradeByCourse.get(course.id)?.columns ?? []
    return {
      course,
      pct: gradePercent(columns),
      status: planStatus({
        term: course.term,
        today,
        columns,
        exams: examsByCourse.get(course.id) ?? [],
      }),
    }
  })
}

/** Кредиты плана: всего и набрано — только по завершённым дисциплинам. */
export function planCredits(plan: PlanEntry[]): { total: number; done: number } {
  let total = 0
  let done = 0
  for (const p of plan) {
    const cr = p.course.credits ?? 0
    total += cr
    if (p.status === 'completed') done += cr
  }
  return { total, done }
}
