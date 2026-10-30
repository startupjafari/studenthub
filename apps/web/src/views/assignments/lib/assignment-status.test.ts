import { describe, expect, it } from 'vitest'
import type { AssignmentItem, SubmissionStatus } from '../../../entities/assignment'
import { canEditSubmission } from './assignment-status'

const NOW = new Date('2026-10-21T12:00:00.000Z')

function asg(o: Partial<AssignmentItem> = {}, sub?: SubmissionStatus): AssignmentItem {
  return {
    id: 'as-1',
    title: 'ЛР1',
    description: null,
    type: 'LAB',
    submissionType: 'TEXT',
    status: 'PUBLISHED',
    maxScore: 10,
    maxAttempts: null,
    allowLate: false,
    publishAt: null,
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
    mySubmission: sub
      ? {
          id: 'sub-1',
          status: sub,
          text: null,
          linkUrl: null,
          attemptNumber: 1,
          score: null,
          feedback: null,
          submittedAt: null,
          gradedAt: null,
          createdAt: '2026-10-01T09:00:00.000Z',
          student: { id: 'stu-1', firstName: 'А', lastName: 'Б' },
          gradedBy: null,
        }
      : null,
    ...o,
  }
}

describe('canEditSubmission', () => {
  it('после срока без поздней сдачи форма закрыта — сервер ответил бы 409', () => {
    expect(canEditSubmission(asg(), NOW)).toBe(false)
    expect(canEditSubmission(asg({}, 'DRAFT'), NOW)).toBe(false)
  })

  it('поздняя сдача разрешена или срок впереди — форма открыта', () => {
    expect(canEditSubmission(asg({ allowLate: true }), NOW)).toBe(true)
    expect(canEditSubmission(asg({ dueAt: '2026-10-25T18:00:00.000Z' }, 'DRAFT'), NOW)).toBe(true)
  })

  it('возвращённую на доработку можно исправить и после срока', () => {
    expect(canEditSubmission(asg({}, 'RETURNED'), NOW)).toBe(true)
  })

  it('закрытое задание не принимает работы', () => {
    expect(canEditSubmission(asg({ status: 'CLOSED', dueAt: null }, 'RETURNED'), NOW)).toBe(false)
  })
})
