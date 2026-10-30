import { describe, expect, it } from 'vitest'
import type { AssignmentItem } from '../../../entities/assignment'
import { assignmentFormDefaults, buildAssignmentPatch, toLocalInput } from './assignment-patch'

const assignment: AssignmentItem = {
  id: 'as-1',
  title: 'ЛР1',
  description: 'Условие',
  type: 'LAB',
  submissionType: 'TEXT',
  status: 'PUBLISHED',
  maxScore: 10,
  maxAttempts: null,
  allowLate: false,
  publishAt: '2026-10-01T09:00:00.000Z',
  dueAt: '2026-10-20T18:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  course: {
    id: 'c-1',
    groupId: 'grp-1',
    teacherId: 't-1',
    subject: { id: 's-1', name: 'Физика' },
    group: { id: 'grp-1', name: 'ФИ-21' },
  },
  createdBy: { id: 't-1', firstName: 'А', lastName: 'Б' },
}

describe('buildAssignmentPatch', () => {
  it('без правок — пустое тело: срок не «меняется» на секунды при пересчёте', () => {
    expect(buildAssignmentPatch(assignment, assignmentFormDefaults(assignment))).toEqual({})
  })

  it('продление срока — только dueAt', () => {
    const values = { ...assignmentFormDefaults(assignment), dueAtLocal: '2030-01-10T18:00' }
    const patch = buildAssignmentPatch(assignment, values)
    expect(Object.keys(patch)).toEqual(['dueAt'])
    expect(patch.dueAt).toBe(new Date('2030-01-10T18:00').toISOString())
  })

  it('очищенные поля снимаются через null', () => {
    const values = {
      ...assignmentFormDefaults(assignment),
      description: '  ',
      maxScore: '',
      dueAtLocal: '',
    }
    expect(buildAssignmentPatch(assignment, values)).toEqual({
      description: null,
      maxScore: null,
      dueAt: null,
    })
  })

  it('название обрезается, максимум — числом', () => {
    const values = { ...assignmentFormDefaults(assignment), title: ' ЛР1 (испр.) ', maxScore: '20' }
    expect(buildAssignmentPatch(assignment, values)).toEqual({
      title: 'ЛР1 (испр.)',
      maxScore: 20,
    })
  })

  it('toLocalInput: пустой и битый срок — пустое поле', () => {
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('not-a-date')).toBe('')
  })
})
