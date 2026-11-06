import { Role } from '@studenthub/shared-types'
import {
  canTransitionApplication,
  isApplicationFinal,
  CAREER_APPLICATION_STATUSES,
} from '@studenthub/shared-schemas'
import { ApplicationsService } from './applications.service'
import { CareerAccessService } from './career-access.service'
import type { CareerNotifier } from './career-notifier'
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
    careerApplication: {
      create: jest.fn().mockResolvedValue({ id: 'a-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    careerApplicationEvent: { create: jest.fn() },
  }
  const prisma = {
    vacancy: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'v-1', companyId: 'co-1', deadline: null, title: 'Стажёр' }),
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
  // Граница воронки по допускам — своя логика в career-access.service.spec.ts; здесь
  // проверяем, что она доходит до выборок.
  const scope = { OR: [{ universityId: { in: ['uni-1'] } }] }
  const access = {
    requireCompany: jest.fn().mockReturnValue('co-1'),
    applicationScopeWhere: jest.fn().mockResolvedValue(scope),
  }
  // Уведомление компании о новом кандидате: сборка и доставка — в career-notifier.spec.ts.
  const notifier = { newApplication: jest.fn().mockResolvedValue(undefined) }
  const service = new ApplicationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    access as unknown as CareerAccessService,
    notifier as unknown as CareerNotifier,
  )
  return { service, prisma, tx, audit, queue, access, scope, notifier }
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

  it('на вакансию компании без действующего допуска в вуз откликнуться нельзя', async () => {
    const { service, prisma } = setup()

    await service.apply(student('uni-7'), { vacancyId: 'v-1' }, ctx)

    // Истёкший допуск решений вуза по вакансиям не трогает — проверка допуска обязана быть
    // в самой выборке, иначе компания собирала бы кандидатов вуза, куда её уже не пускают.
    expect(prisma.vacancy.findFirst.mock.calls[0][0].where).toMatchObject({
      company: {
        universityAccess: {
          some: {
            universityId: 'uni-7',
            status: 'APPROVED',
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          },
        },
      },
    })
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

  // D-F28: компания узнавала о новом кандидате, только открыв воронку.
  it('новый отклик — уведомление компании; повторный (CONFLICT) — нет', async () => {
    const { service, notifier, prisma } = setup()
    await service.apply(student(), { vacancyId: 'v-1' }, ctx)
    expect(notifier.newApplication).toHaveBeenCalledWith({
      id: 'a-1',
      companyId: 'co-1',
      vacancyId: 'v-1',
      vacancyTitle: 'Стажёр',
    })

    notifier.newApplication.mockClear()
    prisma.careerApplication.findUnique.mockResolvedValue({ id: 'a-1' })
    await expect(service.apply(student(), { vacancyId: 'v-1' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
    expect(notifier.newApplication).not.toHaveBeenCalled()
  })
})

describe('ApplicationsService — свои отклики студента', () => {
  it('фильтр по вакансии доходит до выборки — окно вакансии спрашивает именно про неё', async () => {
    const { service, prisma } = setup()
    await service.listMine(student(), { page: 1, limit: 1, vacancyId: 'v-2' })
    const where = prisma.careerApplication.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ studentId: 'stu-1', vacancyId: 'v-2' })
    expect(prisma.careerApplication.count.mock.calls[0][0].where).toMatchObject({
      vacancyId: 'v-2',
    })
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
      vacancy: { title: 'Frontend-стажёр' },
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
      vacancy: { title: 'Frontend-стажёр' },
    })

    await service.changeStatus(employer, 'a-1', { status: 'SHORTLISTED' }, ctx)

    expect(tx.careerApplicationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fromStatus: 'SUBMITTED', toStatus: 'SHORTLISTED' }),
      }),
    )
    // Запись условная: статус должен быть тем же, что прочитали.
    expect(tx.careerApplication.update).toHaveBeenCalledWith({
      where: { id: 'a-1', status: 'SUBMITTED' },
      data: { status: 'SHORTLISTED' },
    })
  })

  it('студент узнаёт о движении по заявке — молчание и есть претензия к job-бордам', async () => {
    const { service, prisma, queue } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue({
      id: 'a-1',
      status: 'SUBMITTED',
      studentId: 'stu-1',
      vacancyId: 'v-1',
      vacancy: { title: 'Frontend-стажёр' },
    })

    await service.changeStatus(employer, 'a-1', { status: 'VIEWED' }, ctx)

    // Проверяем именно ФОРМАТ payload: без recipientIds и dedupeKey процессор
    // уведомлений молча отбрасывает job — уведомление не дошло бы, и в логах было бы
    // тихо. Ровно это я и написал в первой версии.
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        recipientIds: ['stu-1'],
        dedupeKey: expect.any(String),
        type: 'APP_UPDATE',
        // Заголовок — название вакансии: его пишет работодатель, словарной статьи ему нет.
        title: 'Frontend-стажёр',
        // Тело — ключ статьи: строку соберёт процессор на языке получателя.
        bodyKey: expect.any(String),
      }),
      expect.anything(),
    )
  })

  it('причина отказа уходит студенту вместо шаблонного текста', async () => {
    const { service, prisma, queue } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue({
      id: 'a-1',
      status: 'SUBMITTED',
      studentId: 'stu-1',
      vacancyId: 'v-1',
      vacancy: { title: 'Frontend-стажёр' },
    })

    await service.changeStatus(employer, 'a-1', { status: 'REJECTED', comment: 'нужен опыт' }, ctx)

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ body: 'нужен опыт' }),
      expect.anything(),
    )
  })

  it('воронка ограничена откликами в границах допуска компании', async () => {
    const { service, prisma, access, scope } = setup()

    await service.pipeline(employer, { page: 1, limit: 20 })

    expect(access.applicationScopeWhere).toHaveBeenCalledWith('co-1')
    const where = prisma.careerApplication.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ companyId: 'co-1', AND: [scope] })
    expect(prisma.careerApplication.count.mock.calls[0][0].where).toBe(where)
  })

  it('отклик вне границы допуска двигать нельзя — та же граница, что у воронки', async () => {
    const { service, prisma, scope } = setup()
    prisma.careerApplication.findFirst.mockResolvedValue(null)

    await expect(
      service.changeStatus(employer, 'a-1', { status: 'VIEWED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
    expect(prisma.careerApplication.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'a-1',
      companyId: 'co-1',
      AND: [scope],
    })
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
