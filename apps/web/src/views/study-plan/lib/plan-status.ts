import type { ExamResultStatus } from '@studenthub/shared-schemas'

export type PlanStatus = 'completed' | 'studying' | 'upcoming' | 'notPassed'

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

/**
 * Статус дисциплины в учебном плане (C-F26).
 *
 * Раньше «Пройдена/Не сдана» ставилась по первой же опубликованной оценке — после первой
 * лабораторной на 6/10 дисциплина текущего семестра становилась пройденной и добавляла
 * кредиты в прогресс. Теперь итог подводится только у завершённой дисциплины:
 *  1) семестр идёт (`isActive`) — «изучается», процент справочно;
 *  2) есть итог экзамена (последний по дате, не «назначен») — он и решает;
 *  3) есть оценённые колонки «Экзамен» — по ним;
 *  4) прошлый семестр (не текущий, а оценки есть — значит, уже прошёл) — по всем
 *     опубликованным оценкам дисциплины, а не по первой;
 *  5) без семестра оценки не говорят, кончилась ли дисциплина, — «изучается»;
 *  6) оценок нет — «предстоит».
 */
export function planStatus(input: {
  termActive: boolean
  hasTerm: boolean
  columns: PlanGradeColumn[]
  exams: PlanExamResult[]
}): PlanStatus {
  if (input.termActive) return 'studying'
  const final = [...input.exams]
    .filter((e) => e.status !== 'SCHEDULED')
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  if (final) return final.status === 'PASSED' ? 'completed' : 'notPassed'
  const examPct = gradePercent(input.columns.filter((c) => c.kind === 'EXAM'))
  if (examPct !== null) return examPct >= PASS_THRESHOLD ? 'completed' : 'notPassed'
  const pct = gradePercent(input.columns)
  if (pct === null) return 'upcoming'
  if (!input.hasTerm) return 'studying'
  return pct >= PASS_THRESHOLD ? 'completed' : 'notPassed'
}
