import { describe, expect, it } from 'vitest'
import { studentAssignmentStatus } from './status'
import type { AssignmentItem, SubmissionItem, SubmissionStatus } from '../model/types'

const NOW = new Date('2026-06-15T12:00:00Z')
const PAST = '2026-06-01T00:00:00.000Z'
const FUTURE = '2026-07-01T00:00:00.000Z'

function sub(status: SubmissionStatus): SubmissionItem {
  return {
    id: 'sub1',
    status,
    text: null,
    linkUrl: null,
    attemptNumber: 1,
    score: null,
    feedback: null,
    submittedAt: null,
    gradedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    student: { id: 'u1', firstName: 'A', lastName: 'B' },
    gradedBy: null,
  }
}

function asg(o: Partial<AssignmentItem> = {}): AssignmentItem {
  return {
    id: 'a1',
    title: 'A',
    description: null,
    type: 'HOMEWORK',
    submissionType: 'TEXT',
    status: 'PUBLISHED',
    maxScore: 100,
    maxAttempts: null,
    allowLate: false,
    publishAt: null,
    dueAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    course: {
      id: 'c1',
      groupId: 'g1',
      teacherId: null,
      subject: { id: 's1', name: 'Math' },
      group: { id: 'g1', name: 'G' },
    },
    createdBy: { id: 't1', firstName: 'T', lastName: 'T' },
    mySubmission: null,
    ...o,
  }
}

describe('studentAssignmentStatus', () => {
  it('без сдачи и срока → NOT_STARTED', () => {
    expect(studentAssignmentStatus(asg(), NOW)).toBe('NOT_STARTED')
  })

  it('без сдачи, срок прошёл, allowLate=false → OVERDUE', () => {
    expect(studentAssignmentStatus(asg({ dueAt: PAST }), NOW)).toBe('OVERDUE')
  })

  it('без сдачи, срок прошёл, но allowLate=true → NOT_STARTED', () => {
    expect(studentAssignmentStatus(asg({ dueAt: PAST, allowLate: true }), NOW)).toBe('NOT_STARTED')
  })

  it('сдача SUBMITTED → SUBMITTED даже при просрочке', () => {
    expect(studentAssignmentStatus(asg({ dueAt: PAST, mySubmission: sub('SUBMITTED') }), NOW)).toBe(
      'SUBMITTED',
    )
  })

  it('сдача GRADED → GRADED', () => {
    expect(studentAssignmentStatus(asg({ mySubmission: sub('GRADED') }), NOW)).toBe('GRADED')
  })

  it('сдача RETURNED → RETURNED', () => {
    expect(studentAssignmentStatus(asg({ mySubmission: sub('RETURNED') }), NOW)).toBe('RETURNED')
  })

  it('черновик + срок прошёл → OVERDUE', () => {
    expect(studentAssignmentStatus(asg({ dueAt: PAST, mySubmission: sub('DRAFT') }), NOW)).toBe(
      'OVERDUE',
    )
  })

  it('черновик + срок в будущем → DRAFT', () => {
    expect(studentAssignmentStatus(asg({ dueAt: FUTURE, mySubmission: sub('DRAFT') }), NOW)).toBe(
      'DRAFT',
    )
  })
})
