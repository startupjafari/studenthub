import { Role } from '@studenthub/shared-types'
import { ApplicationNotifier, type HandledApplication } from './application-notifier'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'

function setup() {
  const prisma = {
    application: { groupBy: jest.fn().mockResolvedValue([]) },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const notifier = new ApplicationNotifier(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
    new ApplicationPolicy(),
  )
  return { notifier, prisma, queue }
}

const app: HandledApplication = {
  id: 'a1',
  number: 'SH-2026-000042',
  universityId: 'uni',
  facultyId: 'fac',
  assignedToId: null,
}

type Job = { recipientIds: string[]; titleKey: string; data: { url: string }; params: unknown }
const jobs = (queue: { enqueue: jest.Mock }): Job[] =>
  queue.enqueue.mock.calls.map((call) => call[2] as Job)

describe('ApplicationNotifier.notifyHandlers (D-F16)', () => {
  it('новая заявка факультета — деканам факультета, со ссылкой в их очередь', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.user.findMany.mockResolvedValue([
      { id: 'dean-1', role: Role.DEAN },
      { id: 'ua', role: Role.UNIVERSITY_ADMIN },
    ])
    await notifier.notifyHandlers(app, 'submitted', 'ev-1')
    expect(jobs(queue)).toEqual([
      expect.objectContaining({
        recipientIds: ['dean-1'],
        titleKey: 'applications.submitted.title',
        params: { number: 'SH-2026-000042' },
        data: expect.objectContaining({ url: '/dean/applications' }),
      }),
    ])
  })

  it('вузовская услуга (или факультет без декана) — администрации вуза по ролям', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.user.findMany.mockResolvedValue([
      { id: 'ua', role: Role.UNIVERSITY_ADMIN },
      { id: 'um', role: Role.UNIVERSITY_MODERATOR },
    ])
    await notifier.notifyHandlers({ ...app, facultyId: null }, 'submitted', 'ev-1')
    const urls = jobs(queue).map((j) => [j.recipientIds, j.data.url])
    expect(urls).toEqual([
      [['ua'], '/university-admin/applications'],
      [['um'], '/moderator/university/applications'],
    ])
  })

  it('исправленная заявка — её ответственному, а не всем', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({
      id: 'dean-2',
      role: Role.DEAN,
      universityId: 'uni',
      facultyId: 'fac',
    })
    await notifier.notifyHandlers({ ...app, assignedToId: 'dean-2' }, 'resubmitted', 'ev-2')
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(jobs(queue)).toEqual([
      expect.objectContaining({
        recipientIds: ['dean-2'],
        titleKey: 'applications.resubmitted.title',
      }),
    ])
  })

  // Бывший декан стал преподавателем или ведёт другой факультет: его роли нет очереди заявок,
  // и уведомление о повторной отправке раньше не уходило никому.
  it.each([
    ['стал преподавателем', { role: Role.TEACHER, facultyId: 'fac' }],
    ['ведёт другой факультет', { role: Role.DEAN, facultyId: 'fac-2' }],
  ])('ответственный %s — уведомление деканам факультета', async (_case, scope) => {
    const { notifier, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'ex-dean', universityId: 'uni', ...scope })
    prisma.user.findMany.mockResolvedValue([{ id: 'dean-1', role: Role.DEAN }])
    await notifier.notifyHandlers({ ...app, assignedToId: 'ex-dean' }, 'resubmitted', 'ev-3')
    expect(jobs(queue)).toEqual([expect.objectContaining({ recipientIds: ['dean-1'] })])
  })

  it('сбой поиска адресатов не роняет подачу', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.user.findMany.mockRejectedValue(new Error('db down'))
    await expect(notifier.notifyHandlers(app, 'submitted', 'ev-1')).resolves.toBeUndefined()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('ApplicationNotifier.notifyOverdue (D-F16)', () => {
  const now = new Date('2026-10-17T04:00:00.000Z')

  it('сводка: назначенные — ответственному, неназначенные — деканам, одна на человека', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.application.groupBy.mockResolvedValue([
      { universityId: 'uni', facultyId: 'fac', assignedToId: 'dean-2', _count: { _all: 2 } },
      { universityId: 'uni', facultyId: 'fac', assignedToId: null, _count: { _all: 3 } },
      { universityId: 'uni', facultyId: null, assignedToId: null, _count: { _all: 1 } },
    ])
    prisma.user.findMany
      // Ответственные по id.
      .mockResolvedValueOnce([
        { id: 'dean-2', role: Role.DEAN, universityId: 'uni', facultyId: 'fac' },
      ])
      // Деканы и администрация вузов из выборки.
      .mockResolvedValueOnce([
        { id: 'dean-1', role: Role.DEAN, universityId: 'uni', facultyId: 'fac' },
        { id: 'dean-2', role: Role.DEAN, universityId: 'uni', facultyId: 'fac' },
        { id: 'ua', role: Role.UNIVERSITY_ADMIN, universityId: 'uni', facultyId: null },
      ])

    await expect(notifier.notifyOverdue(now)).resolves.toBe(3)

    const byUser = Object.fromEntries(
      jobs(queue).map((j) => [j.recipientIds[0], (j.params as { count: number }).count]),
    )
    // dean-2: 2 своих + 3 неназначенных факультета; dean-1: 3; админ — вузовская одна.
    expect(byUser).toEqual({ 'dean-2': 5, 'dean-1': 3, ua: 1 })
    expect(queue.enqueue.mock.calls[0][3]).toEqual({
      jobId: expect.stringContaining('applications-overdue:2026-10-17'),
    })
    // Только поданные, в работе и с истёкшим сроком.
    expect(prisma.application.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submittedAt: { not: null },
          dueAt: { lt: now },
          status: { in: expect.not.arrayContaining(['READY', 'ISSUED', 'CANCELLED']) },
        }),
        take: expect.any(Number),
      }),
    )
  })

  it('ответственный потерял право обработки — его просрочка уходит деканам факультета', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.application.groupBy.mockResolvedValue([
      { universityId: 'uni', facultyId: 'fac', assignedToId: 'ex-dean', _count: { _all: 2 } },
    ])
    prisma.user.findMany
      .mockResolvedValueOnce([
        { id: 'ex-dean', role: Role.TEACHER, universityId: 'uni', facultyId: 'fac' },
      ])
      .mockResolvedValueOnce([
        { id: 'dean-1', role: Role.DEAN, universityId: 'uni', facultyId: 'fac' },
      ])
    await expect(notifier.notifyOverdue(now)).resolves.toBe(1)
    expect(jobs(queue)).toEqual([
      expect.objectContaining({ recipientIds: ['dean-1'], data: { url: '/dean/applications' } }),
    ])
  })

  it('просроченных нет — ни запросов к людям, ни уведомлений', async () => {
    const { notifier, prisma, queue } = setup()
    await expect(notifier.notifyOverdue(now)).resolves.toBe(0)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
