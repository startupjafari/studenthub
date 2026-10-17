import { describe, expect, it } from 'vitest'
import { gradePercent, planStatus, type PlanGradeColumn } from './plan-status'

const lab = (score: number | null, maxScore = 10): PlanGradeColumn => ({
  kind: 'LAB',
  maxScore,
  score,
})

describe('planStatus (C-F26)', () => {
  it('текущий семестр — «изучается» даже после первой оценки 6/10', () => {
    expect(planStatus({ termActive: true, hasTerm: true, columns: [lab(6)], exams: [] })).toBe(
      'studying',
    )
  })

  it('текущий семестр — «изучается» и после 4/10, без «не сдана»', () => {
    expect(planStatus({ termActive: true, hasTerm: true, columns: [lab(4)], exams: [] })).toBe(
      'studying',
    )
  })

  it('прошлый семестр — по всем оценкам, а не по первой', () => {
    // Первая — 6/10, но в сумме 6, 2, 3 из 10 — 37 %.
    const columns = [lab(6), lab(2), lab(3)]
    expect(planStatus({ termActive: false, hasTerm: true, columns, exams: [] })).toBe('notPassed')
    expect(
      planStatus({ termActive: false, hasTerm: true, columns: [lab(4), lab(9)], exams: [] }),
    ).toBe('completed')
  })

  it('итог экзамена решает: последняя попытка, «назначен» не в счёт', () => {
    const exams = [
      { date: '2026-01-10T09:00:00.000Z', status: 'FAILED' as const },
      { date: '2026-01-25T09:00:00.000Z', status: 'PASSED' as const },
      { date: '2026-02-01T09:00:00.000Z', status: 'SCHEDULED' as const },
    ]
    expect(planStatus({ termActive: false, hasTerm: true, columns: [lab(2)], exams })).toBe(
      'completed',
    )
  })

  it('колонка «Экзамен» важнее текущих оценок', () => {
    const columns = [lab(10), { kind: 'EXAM', maxScore: 100, score: 30 }]
    expect(planStatus({ termActive: false, hasTerm: true, columns, exams: [] })).toBe('notPassed')
  })

  it('без семестра оценки не значат конца дисциплины — «изучается»', () => {
    expect(planStatus({ termActive: false, hasTerm: false, columns: [lab(9)], exams: [] })).toBe(
      'studying',
    )
  })

  it('без оценок — «предстоит»', () => {
    expect(planStatus({ termActive: false, hasTerm: true, columns: [lab(null)], exams: [] })).toBe(
      'upcoming',
    )
  })

  it('gradePercent: колонки без максимума или балла не считаются', () => {
    expect(gradePercent([lab(5), lab(null), { kind: 'OTHER', maxScore: null, score: 3 }])).toBe(50)
    expect(gradePercent([])).toBeNull()
  })
})
