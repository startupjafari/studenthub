import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAttention, groupByPriority, type AttentionItem } from './attention'
import type { AssignmentItem, SubmissionItem, SubmissionStatus } from '../../../entities/assignment'
import type { ApplicationListItem } from '../../../entities/application-service'
import type { EventItem } from '../../../entities/event'

const TODAY = '2026-06-15'

// buildAttention зовёт studentAssignmentStatus без now → используется системное время.
// Замораживаем его на TODAY 12:00, чтобы «просрочено/предстоит» были детерминированы.
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
    startsAt: `${TODAY}T18:00:00.000Z`,
    endsAt: null,
    organizerId: 'o1',
    organizer: { id: 'o1', firstName: 'O', lastName: 'O' } as unknown as EventItem['organizer'],
    _count: { participants: 0 },
    isRegistered: false,
    ...o,
  }
}

const base = { applications: [], events: [], assignments: [], todayDate: TODAY, locale: 'ru' }

describe('buildAttention — задания', () => {
  it('RETURNED → urgent/assignmentFix', () => {
    const r = buildAttention({ ...base, assignments: [asg({ mySubmission: sub('RETURNED') })] })
    expect(r[0]).toMatchObject({ kind: 'assignmentFix', priority: 'urgent' })
  })

  it('просрочено → urgent/assignmentOverdue', () => {
    const r = buildAttention({ ...base, assignments: [asg({ dueAt: '2026-06-01T00:00:00.000Z' })] })
    expect(r[0]).toMatchObject({ kind: 'assignmentOverdue', priority: 'urgent' })
  })

  it('SUBMITTED и GRADED пропускаются', () => {
    const r = buildAttention({
      ...base,
      assignments: [
        asg({ id: 's', mySubmission: sub('SUBMITTED') }),
        asg({ id: 'g', mySubmission: sub('GRADED') }),
      ],
    })
    expect(r).toHaveLength(0)
  })

  it('срок сегодня → today; в пределах недели → soon; >7 дней пропуск', () => {
    const r = buildAttention({
      ...base,
      assignments: [
        asg({ id: 'a1', dueAt: `${TODAY}T18:00:00.000Z` }),
        asg({ id: 'a2', dueAt: '2026-06-18T00:00:00.000Z' }),
        asg({ id: 'a3', dueAt: '2026-07-30T00:00:00.000Z' }),
      ],
    })
    const byId = Object.fromEntries(r.map((i) => [i.id, i]))
    expect(byId['asg-a1']!.priority).toBe('today')
    expect(byId['asg-a2']!.priority).toBe('soon')
    expect(byId['asg-a3']).toBeUndefined()
  })
})

describe('buildAttention — заявки и события', () => {
  it('NEEDS_CORRECTION → urgent с meta=number; DRAFT → soon; прочее пропуск', () => {
    const r = buildAttention({
      ...base,
      applications: [
        app({ id: 'c', status: 'NEEDS_CORRECTION', number: 'SH-9' }),
        app({ id: 'd', status: 'DRAFT' }),
        app({ id: 'e', status: 'IN_REVIEW' }),
      ],
    })
    const byId = Object.fromEntries(r.map((i) => [i.id, i]))
    expect(byId['app-c']).toMatchObject({
      priority: 'urgent',
      kind: 'correctApplication',
      meta: 'SH-9',
    })
    expect(byId['app-d']).toMatchObject({ priority: 'soon', kind: 'draftApplication' })
    expect(byId['app-e']).toBeUndefined()
  })

  it('события — только зарегистрированные в окне 7 дней', () => {
    const r = buildAttention({
      ...base,
      events: [
        ev({ id: 'reg', isRegistered: true, startsAt: `${TODAY}T18:00:00.000Z` }),
        ev({ id: 'noreg', isRegistered: false, startsAt: `${TODAY}T18:00:00.000Z` }),
        ev({ id: 'far', isRegistered: true, startsAt: '2026-07-30T00:00:00.000Z' }),
      ],
    })
    const ids = r.map((i) => i.id)
    expect(ids).toContain('event-reg')
    expect(ids).not.toContain('event-noreg')
    expect(ids).not.toContain('event-far')
  })

  it('сортирует по приоритету: urgent → today → soon', () => {
    const r = buildAttention({
      ...base,
      applications: [app({ id: 'd', status: 'DRAFT' })],
      events: [ev({ id: 'reg', isRegistered: true, startsAt: `${TODAY}T18:00:00.000Z` })],
      assignments: [asg({ mySubmission: sub('RETURNED') })],
    })
    expect(r[0]!.priority).toBe('urgent')
    expect(r[r.length - 1]!.priority).toBe('soon')
  })
})

describe('groupByPriority', () => {
  it('раскладывает по трём корзинам', () => {
    const items = [
      { priority: 'urgent' },
      { priority: 'today' },
      { priority: 'soon' },
      { priority: 'urgent' },
    ] as AttentionItem[]
    const g = groupByPriority(items)
    expect(g.urgent).toHaveLength(2)
    expect(g.today).toHaveLength(1)
    expect(g.soon).toHaveLength(1)
  })
})
