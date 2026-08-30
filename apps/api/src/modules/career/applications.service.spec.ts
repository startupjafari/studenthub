import { Role } from '@studenthub/shared-types'
import {
  canTransitionApplication,
  isApplicationFinal,
  CAREER_APPLICATION_STATUSES,
} from '@studenthub/shared-schemas'
import { ApplicationsService } from './applications.service'
import { CareerAccessService } from './career-access.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const student = (universityId: string | null = 'uni-1'): JwtPayload => ({
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId,
  facultyId: null,
  groupId: null,
})

const employer: JwtPayload = {
  sub: 'hr-1',
  role: Role.EMPLOYER,
  universityId: null,
  facultyId: null,
  groupId: null,
  companyId: 'co-1',
}

function setup() {
  const tx = {
    careerApplication: { create: jest.fn().mockResolvedValue({ id: 'a-1' }), update: jest.fn() },
    careerApplicationEvent: { create: jest.fn() },
  }
  const prisma = {
    vacancy: {
      findFirst: jest.fn().mockResolvedValue({ id: 'v-1', companyId: 'co-1', deadline: null }),
    },
    careerApplication: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    careerApplicationEvent: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const access = { requireCompany: jest.fn().mockReturnValue('co-1') }
  const service = new ApplicationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    access as unknown as CareerAccessService,
  )
  return { service, prisma, tx, audit, queue }
}

describe('ApplicationsService — отклик студента', () => {
  it('вакансия должна быть одобрена вузом студента — иначе отклик обходил бы модерацию', async () => {
    const { service, prisma } = setup()

    await service.apply(student('uni-7'), { vacancyId: 'v-1' }, ctx)

    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PUBLISHED',
          reviews: { some: { universityId: 'uni-7', status: 'APPROVED' } },
        }),
      }),
    )
  })

  it('недоступная вакансия — NOT_FOUND, а не отказ по правам', async () => {
    const { service, prisma } = setup()
    prisma.vacancy.findFirst.mockResolvedValue(null)
    await expect(service.apply(student(), { vacancyId: 'v-1' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('после дедлайна откликнуться нельзя', async () => {
    const { service, prisma } = setup()
    prisma.vacancy.findFirst.mockResolvedValue({
      id: 'v-1',
      companyId: 'co-1',
      deadline: new Date(Date.now() - 1000),
    })
    await expect(service.apply(student(), { vacancyId: 'v-1' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('повторный отклик на ту же вакансию — CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.careerApplication.findUnique.mockResolvedValue({ id: 'a-1' })
    await expect(service.apply(student(), { vacancyId: 'v-1' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('отклик сразу заводит первую запись истории', async () => {
    const { service, tx } = setup()
    await service.apply(student(), { vacancyId: 'v-1' }, ctx)
    expect(tx.careerApplicationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'SUBMITTED' }) }),
    )
  })

  it('вуз фиксируется на момент отклика', async () => {
    const { service, tx } = setup()
    await service.apply(student('uni-3'), { vacancyId: 'v-1' }, ctx)
    expect(tx.careerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ universityId: 'uni-3' }) }),
    )
  })

  it('студент без вуза откликнуться не может', async () => {
    const { service } = setup()
    await expect(service.apply(student(null), { vacancyId: 'v-1' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })
})

describe('ApplicationsService — воронка компании', () => {
  it('недопустимый переход отклоняется', async () => {
    const { service, prisma } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue({
      id: 'a-1',
      status: 'HIRED',
      studentId: 'stu-1',
      vacancyId: 'v-1',
    })
    await expect(
      service.changeStatus(employer, 'a-1', { status: 'REJECTED', comment: 'нет' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('переход пишет событие в историю', async () => {
    const { service, prisma, tx } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue({
      id: 'a-1',
      status: 'SUBMITTED',
      studentId: 'stu-1',
      vacancyId: 'v-1',
    })

    await service.changeStatus(employer, 'a-1', { status: 'SHORTLISTED' }, ctx)

    expect(tx.careerApplicationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'SUBMITTED', toStatus: 'SHORTLISTED' }),
      }),
    )
  })

  it('студент узнаёт о движении по заявке — молчание и есть претензия к job-бордам', async () => {
    const { service, prisma, queue } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue({
      id: 'a-1',
      status: 'SUBMITTED',
      studentId: 'stu-1',
      vacancyId: 'v-1',
    })

    await service.changeStatus(employer, 'a-1', { status: 'VIEWED' }, ctx)

    expect(queue.enqueue).toHaveBeenCalled()
  })

  it('чужой отклик компании недоступен', async () => {
    const { service, prisma } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue(null)
    await expect(
      service.changeStatus(employer, 'a-1', { status: 'VIEWED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })
})

describe('ApplicationsService — доступ к истории', () => {
  it('посторонний историю не читает', async () => {
    const { service, prisma } = setup()
    prisma.careerApplication.findUnique.mockResolvedValue({
      id: 'a-1',
      studentId: 'other',
      companyId: 'co-OTHER',
    })
    await expect(service.history(student(), 'a-1')).rejects.toBeInstanceOf(AppException)
  })

  it('автор отклика историю читает', async () => {
    const { service, prisma } = setup()
    prisma.careerApplication.findUnique.mockResolvedValue({
      id: 'a-1',
      studentId: 'stu-1',
      companyId: 'co-1',
    })
    await expect(service.history(student(), 'a-1')).resolves.toEqual([])
  })
})

describe('Воронка откликов — правила переходов', () => {
  it('отказать можно на любом непустом этапе до найма', () => {
    for (const from of ['SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER'] as const) {
      expect(canTransitionApplication(from, 'REJECTED')).toBe(true)
    }
  })

  it('из конечных состояний переходов нет', () => {
    for (const status of ['HIRED', 'REJECTED', 'WITHDRAWN'] as const) {
      expect(isApplicationFinal(status)).toBe(true)
    }
  })

  it('нанять можно только после оффера', () => {
    expect(canTransitionApplication('OFFER', 'HIRED')).toBe(true)
    expect(canTransitionApplication('SUBMITTED', 'HIRED')).toBe(false)
    expect(canTransitionApplication('INTERVIEW', 'HIRED')).toBe(false)
  })

  it('у каждого статуса описан набор переходов', () => {
    for (const status of CAREER_APPLICATION_STATUSES) {
      expect(canTransitionApplication(status, status)).toBe(false)
    }
  })
})
