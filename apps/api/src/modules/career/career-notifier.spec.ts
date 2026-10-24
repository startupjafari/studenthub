import { Role } from '@studenthub/shared-types'
import { CareerNotifier } from './career-notifier'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'

function setup() {
  const prisma = {
    company: { findFirst: jest.fn().mockResolvedValue({ name: 'Acme' }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'adm-1' }, { id: 'adm-2' }]) },
    companyMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'hr-1' }, { userId: 'hr-2' }]),
    },
    university: {
      findFirst: jest.fn().mockResolvedValue({ name: 'Университет Туран', shortName: 'Туран' }),
    },
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const notifier = new CareerNotifier(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
  )
  return { notifier, prisma, queue }
}

const at = new Date('2026-10-17T10:00:00Z')

describe('CareerNotifier — заявка компании на допуск', () => {
  it('уходит администрации вуза, повторная подача — новым событием', async () => {
    const { notifier, prisma, queue } = setup()

    await notifier.accessRequested({ companyId: 'co-1', universityId: 'uni-1', requestedAt: at })

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          universityId: 'uni-1',
          role: Role.UNIVERSITY_ADMIN,
          deletedAt: null,
          isBlocked: false,
        },
        take: expect.any(Number),
      }),
    )
    const [queueName, jobName, job, opts] = queue.enqueue.mock.calls[0]
    expect(queueName).toBe('notifications')
    expect(jobName).toBe('application-updated')
    expect(job).toMatchObject({
      recipientIds: ['adm-1', 'adm-2'],
      type: 'APP_UPDATE',
      titleKey: 'career.accessRequested.title',
      bodyKey: 'career.accessRequested.body',
      params: { company: 'Acme' },
      data: { url: '/career/companies' },
      dedupeKey: `company-access-requested:co-1:uni-1:${at.getTime()}`,
    })
    expect(opts).toEqual({ jobId: job.dedupeKey })
  })

  it('администрации в вузе нет — ничего не ставит', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.user.findMany.mockResolvedValue([])
    await notifier.accessRequested({ companyId: 'co-1', universityId: 'uni-1', requestedAt: at })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('CareerNotifier — решение по допуску', () => {
  it('отказ с причиной — причина в теле, вуз коротким названием', async () => {
    const { notifier, prisma, queue } = setup()

    await notifier.accessDecided({
      accessId: 'a-1',
      companyId: 'co-1',
      universityId: 'uni-1',
      status: 'REJECTED',
      reason: '  мало данных  ',
      decidedAt: at,
    })

    expect(prisma.companyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1' }, take: expect.any(Number) }),
    )
    expect(queue.enqueue.mock.calls[0][2]).toMatchObject({
      recipientIds: ['hr-1', 'hr-2'],
      titleKey: 'career.accessRejected.title',
      bodyKey: 'career.universityReason.body',
      params: { university: 'Туран', reason: 'мало данных' },
      data: { url: '/employer/access' },
      dedupeKey: `company-access:a-1:REJECTED:${at.getTime()}`,
    })
  })

  it('одобрение без причины — шаблон с одним вузом', async () => {
    const { notifier, queue } = setup()
    await notifier.accessDecided({
      accessId: 'a-1',
      companyId: 'co-1',
      universityId: 'uni-1',
      status: 'APPROVED',
      decidedAt: at,
    })
    const job = queue.enqueue.mock.calls[0][2]
    expect(job).toMatchObject({
      titleKey: 'career.accessApproved.title',
      bodyKey: 'career.university.body',
      params: { university: 'Туран' },
    })
    expect(job.params).not.toHaveProperty('reason')
  })

  it('REQUESTED — не решение, уведомления нет', async () => {
    const { notifier, queue } = setup()
    await notifier.accessDecided({
      accessId: 'a-1',
      companyId: 'co-1',
      universityId: 'uni-1',
      status: 'REQUESTED',
      decidedAt: at,
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('CareerNotifier — истечение допуска', () => {
  it('свой заголовок «срок истёк», а не «отозван»: решения вуза не было', async () => {
    const { notifier, queue } = setup()
    await notifier.accessExpired({
      accessId: 'a-1',
      companyId: 'co-1',
      universityId: 'uni-1',
      expiredAt: at,
    })
    expect(queue.enqueue.mock.calls[0][2]).toMatchObject({
      recipientIds: ['hr-1', 'hr-2'],
      titleKey: 'career.accessExpired.title',
      bodyKey: 'career.university.body',
      params: { university: 'Туран' },
      data: { url: '/employer/access' },
      dedupeKey: `company-access:a-1:EXPIRED:${at.getTime()}`,
    })
  })
})

describe('CareerNotifier — решение по вакансии', () => {
  it('одобрение — компании, с названием вакансии и вуза', async () => {
    const { notifier, queue } = setup()
    await notifier.vacancyDecided({
      reviewId: 'r-1',
      companyId: 'co-1',
      vacancyTitle: 'Стажёр-аналитик',
      universityId: 'uni-1',
      status: 'APPROVED',
      decidedAt: at,
    })
    expect(queue.enqueue.mock.calls[0][2]).toMatchObject({
      recipientIds: ['hr-1', 'hr-2'],
      titleKey: 'career.vacancyApproved.title',
      bodyKey: 'career.vacancy.body',
      params: { title: 'Стажёр-аналитик', university: 'Туран' },
      data: { url: '/employer/vacancies' },
      dedupeKey: `vacancy-review:r-1:APPROVED:${at.getTime()}`,
    })
  })

  it('PENDING — не решение, уведомления нет', async () => {
    const { notifier, queue } = setup()
    await notifier.vacancyDecided({
      reviewId: 'r-1',
      companyId: 'co-1',
      vacancyTitle: 'Стажёр-аналитик',
      universityId: 'uni-1',
      status: 'PENDING',
      decidedAt: at,
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('CareerNotifier — новый отклик', () => {
  it('свёрнутое уведомление: одна строка на вакансию, событие — id отклика', async () => {
    const { notifier, queue } = setup()
    await notifier.newApplication({
      id: 'app-1',
      companyId: 'co-1',
      vacancyId: 'v-1',
      vacancyTitle: 'Стажёр-аналитик',
    })
    const job = queue.enqueue.mock.calls[0][2]
    expect(job).toMatchObject({
      recipientIds: ['hr-1', 'hr-2'],
      titleKey: 'career.newApplication.title',
      bodyKey: 'career.newApplication.body',
      params: { title: 'Стажёр-аналитик' },
      data: { url: '/employer/candidates', vacancyId: 'v-1', applicationId: 'app-1' },
      dedupeKey: 'career-application-new:app-1',
      collapseKey: 'career-applications:v-1',
    })
    // Имени студента в уведомлении нет: оно уходит в push-сервисы и почту.
    expect(JSON.stringify(job)).not.toMatch(/stu-|firstName|lastName/)
  })

  it('сбой чтения не роняет вызвавшего: отклик уже записан', async () => {
    const { notifier, prisma, queue } = setup()
    prisma.companyMember.findMany.mockRejectedValue(new Error('db down'))
    await expect(
      notifier.newApplication({
        id: 'app-1',
        companyId: 'co-1',
        vacancyId: 'v-1',
        vacancyTitle: 'Стажёр-аналитик',
      }),
    ).resolves.toBeUndefined()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
