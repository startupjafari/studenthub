import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTasks, groupTasks } from './tasks'
import type { AssignmentItem, SubmissionItem, SubmissionStatus } from '../../../entities/assignment'
import type { ApplicationListItem } from '../../../entities/application-service'
import type { EventItem } from '../../../entities/event'

const TODAY = '2026-06-15'

// buildTasks → studentAssignmentStatus без now: замораживаем системное время на TODAY.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`))
})
afterEach(() => vi.useRealTimers())

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

function app(o: Partial<ApplicationListItem> = {}): ApplicationListItem {
  return {
    id: 'app1',
    number: 'SH-2026-1',
    status: 'DRAFT',
    deliveryType: null,
    formData: {},
    studentId: 'u1',
    facultyId: null,
    universityId: 'uni1',
    assignedToId: null,
    submittedAt: null,
    dueAt: null,
    readyAt: null,
    issuedAt: null,
    cancelledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    service: {
      nameRu: 'Справка',
      nameKk: 'A',
      nameEn: 'Cert',
    } as unknown as ApplicationListItem['service'],
    ...o,
  }
}

function ev(o: Partial<EventItem> = {}): EventItem {
  return {
    id: 'e1',
    audience: 'ALL' as EventItem['audience'],
    title: 'Event',
    description: '',
    location: null,
    isOnline: false,
    startsAt: `${TODAY}T10:00:00.000Z`,
    endsAt: null,
    organizerId: 'o1',
    organizer: { id: 'o1', firstName: 'O', lastName: 'O' } as unknown as EventItem['organizer'],
    _count: { participants: 0 },
    isRegistered: false,
    ...o,
  }
}

const base = { applications: [], events: [], assignments: [], todayDate: TODAY, locale: 'ru' }

describe('buildTasks — задания', () => {
  it('GRADED → корзина done; SUBMITTED (ждём проверку) пропуск', () => {
    const r = buildTasks({
      ...base,
      assignments: [
        asg({ id: 'g', mySubmission: sub('GRADED') }),
        asg({ id: 's', mySubmission: sub('SUBMITTED') }),
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'assignment-g', bucket: 'done', done: true })
  })

  it('RETURNED без срока → urgent/assignmentFix', () => {
    const r = buildTasks({
      ...base,
      assignments: [asg({ id: 'r', mySubmission: sub('RETURNED') })],
    })
    expect(r[0]).toMatchObject({ kind: 'assignmentFix', bucket: 'urgent' })
  })

  it('бакет по сроку: прошёл→urgent, сегодня→today, неделя→week, позже→later', () => {
    const r = buildTasks({
      ...base,
      assignments: [
        asg({ id: 'p', dueAt: '2026-06-10T00:00:00.000Z' }),
        asg({ id: 't', dueAt: `${TODAY}T00:00:00.000Z` }),
        asg({ id: 'w', dueAt: '2026-06-20T00:00:00.000Z' }),
        asg({ id: 'l', dueAt: '2026-08-01T00:00:00.000Z' }),
      ],
    })
    const b = Object.fromEntries(r.map((i) => [i.id, i.bucket]))
    expect(b['assignment-p']).toBe('urgent')
    expect(b['assignment-t']).toBe('today')
    expect(b['assignment-w']).toBe('week')
    expect(b['assignment-l']).toBe('later')
  })
})

describe('buildTasks — заявки и события', () => {
  it('DRAFT→submitApplication, ISSUED→done, in-review пропуск', () => {
    const r = buildTasks({
      ...base,
      applications: [
        app({ id: 'd', status: 'DRAFT' }),
        app({ id: 'i', status: 'ISSUED', issuedAt: '2026-06-14T00:00:00.000Z' }),
        app({ id: 'rev', status: 'IN_REVIEW' }),
      ],
    })
    const byId = Object.fromEntries(r.map((i) => [i.id, i]))
    expect(byId['app-d']).toMatchObject({ kind: 'submitApplication' })
    expect(byId['app-i']).toMatchObject({ bucket: 'done', kind: 'applicationDone' })
    expect(byId['app-rev']).toBeUndefined()
  })

  it('READY_FOR_PICKUP без срока → urgent/pickupDocument', () => {
    const r = buildTasks({
      ...base,
      applications: [app({ id: 'pk', status: 'READY_FOR_PICKUP', dueAt: null })],
    })
    expect(r[0]).toMatchObject({ kind: 'pickupDocument', bucket: 'urgent' })
  })

  it('события — только зарегистрированные в окне 0..30 дней', () => {
    const r = buildTasks({
      ...base,
      events: [
        ev({ id: 'ok', isRegistered: true, startsAt: `${TODAY}T10:00:00.000Z` }),
        ev({ id: 'no', isRegistered: false, startsAt: `${TODAY}T10:00:00.000Z` }),
        ev({ id: 'far', isRegistered: true, startsAt: '2026-08-01T00:00:00.000Z' }),
      ],
    })
    const ids = r.map((i) => i.id)
    expect(ids).toContain('event-ok')
    expect(ids).not.toContain('event-no')
    expect(ids).not.toContain('event-far')
  })
})

describe('groupTasks', () => {
  it('раскладывает по корзинам и сортирует по dueAt внутри', () => {
    const r = buildTasks({
      ...base,
      assignments: [
        asg({ id: 'w2', dueAt: '2026-06-20T00:00:00.000Z' }),
        asg({ id: 'w1', dueAt: '2026-06-18T00:00:00.000Z' }),
      ],
    })
    const g = groupTasks(r)
    expect(g.week.map((t) => t.id)).toEqual(['assignment-w1', 'assignment-w2'])
  })
})
