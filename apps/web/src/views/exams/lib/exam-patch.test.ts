import { describe, expect, it } from 'vitest'
import type { ExamItem } from '../../../entities/exam'
import { buildExamPatch, examFormDefaults, toLocalInput } from './exam-patch'

const exam: ExamItem = {
  id: 'ex-1',
  date: '2026-06-10T04:00:00.000Z',
  format: 'WRITTEN',
  maxScore: 100,
  note: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  groupId: 'grp-1',
  course: { id: 'c-1', teacherId: 't-1', subject: { id: 's-1', name: 'Матанализ' } },
  group: { id: 'grp-1', name: 'ФИ-21' },
  room: { id: 'r-1', name: '101' },
  examiner: { id: 't-1', firstName: 'А', lastName: 'Б' },
}

describe('buildExamPatch', () => {
  it('без правок — пустое тело: ни ложного переноса, ни лишней проверки пересечений', () => {
    expect(buildExamPatch(exam, examFormDefaults(exam))).toEqual({})
  })

  it('перенос — только дата', () => {
    const form = { ...examFormDefaults(exam), dateLocal: '2026-06-12T10:00' }
    expect(buildExamPatch(exam, form)).toEqual({
      date: new Date('2026-06-12T10:00').toISOString(),
    })
  })

  it('аудиторию и экзаменатора можно снять и сменить', () => {
    const form = { ...examFormDefaults(exam), roomId: null, examinerId: 't-2' }
    expect(buildExamPatch(exam, form)).toEqual({ roomId: null, examinerId: 't-2' })
  })

  it('экзаменатора нет в форме — поле не уходит', () => {
    const form = { ...examFormDefaults(exam), examinerId: undefined, maxScore: '' }
    expect(buildExamPatch(exam, form)).toEqual({ maxScore: null })
  })

  it('toLocalInput — локальное время без секунд', () => {
    const local = toLocalInput(exam.date)
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(new Date(local).toISOString()).toBe(exam.date)
  })
})
