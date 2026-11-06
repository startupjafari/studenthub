import { describe, expect, it } from 'vitest'
import { gradePercent, planStatus, termPhase, type PlanGradeColumn } from './plan-status'

const lab = (score: number | null, maxScore = 10): PlanGradeColumn => ({
  kind: 'LAB',
  maxScore,
  score,
})

const TODAY = '2026-10-24'
const CURRENT = { isActive: true, startsOn: '2026-09-01', endsOn: '2026-12-31' }
const PAST = { isActive: false, startsOn: '2026-02-01', endsOn: '2026-06-30' }
const FUTURE = { isActive: false, startsOn: '2027-02-01', endsOn: '2027-06-30' }

describe('planStatus (C-F26)', () => {
  it('текущий семестр — «изучается» даже после первой оценки 6/10', () => {
    expect(planStatus({ term: CURRENT, today: TODAY, columns: [lab(6)], exams: [] })).toBe(
      'studying',
    )
  })

  it('текущий семестр — «изучается» и после 4/10, без «не сдана»', () => {
    expect(planStatus({ term: CURRENT, today: TODAY, columns: [lab(4)], exams: [] })).toBe(
      'studying',
    )
  })

  it('прошлый семестр — по всем оценкам, а не по первой', () => {
    // Первая — 6/10, но в сумме 6, 2, 3 из 10 — 37 %.
    const columns = [lab(6), lab(2), lab(3)]
    expect(planStatus({ term: PAST, today: TODAY, columns, exams: [] })).toBe('notPassed')
    expect(planStatus({ term: PAST, today: TODAY, columns: [lab(4), lab(9)], exams: [] })).toBe(
      'completed',
    )
  })

  it('итог экзамена решает: последняя попытка, «назначен» не в счёт', () => {
    const exams = [
      { date: '2026-01-10T09:00:00.000Z', status: 'FAILED' as const },
      { date: '2026-01-25T09:00:00.000Z', status: 'PASSED' as const },
      { date: '2026-02-01T09:00:00.000Z', status: 'SCHEDULED' as const },
    ]
    expect(planStatus({ term: PAST, today: TODAY, columns: [lab(2)], exams })).toBe('completed')
  })

  it('колонка «Экзамен» важнее текущих оценок', () => {
    const columns = [lab(10), { kind: 'EXAM', maxScore: 100, score: 30 }]
    expect(planStatus({ term: PAST, today: TODAY, columns, exams: [] })).toBe('notPassed')
  })

  it('без семестра оценки не значат конца дисциплины — «изучается»', () => {
    expect(planStatus({ term: null, today: TODAY, columns: [lab(9)], exams: [] })).toBe('studying')
  })

  it('без оценок: без семестра — «предстоит», прошлый семестр — «нет итога»', () => {
    expect(planStatus({ term: null, today: TODAY, columns: [lab(null)], exams: [] })).toBe(
      'upcoming',
    )
    expect(planStatus({ term: PAST, today: TODAY, columns: [lab(null)], exams: [] })).toBe(
      'noResult',
    )
  })

  // BUG-338: фаза семестра — по датам, а не по одному isActive.
  it('будущий семестр с ранней оценкой — «предстоит», а не «пройдена»', () => {
    expect(planStatus({ term: FUTURE, today: TODAY, columns: [lab(9)], exams: [] })).toBe(
      'upcoming',
    )
  })

  it('без активного семестра идущий по датам семестр — «изучается»', () => {
    const running = { ...CURRENT, isActive: false }
    expect(planStatus({ term: running, today: TODAY, columns: [lab(9)], exams: [] })).toBe(
      'studying',
    )
    expect(termPhase(running, TODAY)).toBe('current')
    expect(termPhase(PAST, TODAY)).toBe('past')
    expect(termPhase(FUTURE, TODAY)).toBe('future')
  })

  it('gradePercent: колонки без максимума или балла не считаются', () => {
    expect(gradePercent([lab(5), lab(null), { kind: 'OTHER', maxScore: null, score: 3 }])).toBe(50)
    expect(gradePercent([])).toBeNull()
  })
})
