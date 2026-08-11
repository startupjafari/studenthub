import { Role } from '@studenthub/shared-types'
import { ApplicationsService } from './applications.service'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const student: JwtPayload = {
  sub: 'stud',
  role: Role.STUDENT,
  universityId: 'uni',
  facultyId: 'fac',
  groupId: 'g',
}

function setup(overrides: Record<string, jest.Mock> = {}) {
  const application = {
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'new' }),
    count: jest.fn().mockResolvedValue(0),
  }
  const applicationService = { findFirst: jest.fn(), findUnique: jest.fn() }
  const serviceFormField = { findMany: jest.fn().mockResolvedValue([]) }
  const serviceRequirement = { findMany: jest.fn().mockResolvedValue([]) }
  const applicationDocument = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  }
  const applicationEvent = { create: jest.fn().mockResolvedValue({}) }
  const tx = {
    application,
    applicationService,
    serviceFormField,
    serviceRequirement,
    applicationDocument,
    applicationEvent,
  }
  const prisma = {
    ...tx,
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
    ...overrides,
  }
  const service = new ApplicationsService(
    prisma as unknown as PrismaService,
    new ApplicationPolicy(),
  )
  return {
    service,
    prisma,
    application,
    applicationService,
    serviceRequirement,
    applicationDocument,
  }
}

describe('ApplicationsService.createDraft', () => {
  it('без университета → BAD_REQUEST', async () => {
    const { service } = setup()
    const noUni = { ...student, universityId: null }
    await expect(service.createDraft(noUni, 's1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('услуга не найдена → NOT_FOUND', async () => {
    const { service, applicationService } = setup()
    applicationService.findFirst.mockResolvedValue(null)
    await expect(service.createDraft(student, 's1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('ApplicationsService.submit — gating', () => {
  const draft = {
    id: 'a1',
    studentId: 'stud',
    status: 'DRAFT',
    serviceId: 's1',
    deliveryType: null,
    formData: {},
  }

  it('без способа получения → BAD_REQUEST', async () => {
    const { service, application, applicationService } = setup()
    application.findFirst.mockResolvedValue(draft)
    applicationService.findUnique.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('не приложен обязательный документ → BAD_REQUEST', async () => {
    const { service, application, applicationService, serviceRequirement } = setup()
    application.findFirst.mockResolvedValue({ ...draft, deliveryType: 'ELECTRONIC' })
    applicationService.findUnique.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    serviceRequirement.findMany.mockResolvedValue([{ id: 'r1', titleRu: 'Удостоверение' }])
    // applicationDocument.findMany → [] (по умолчанию) → требование не покрыто
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('ApplicationsService.cancel / resubmit', () => {
  it('cancel из IN_PREPARATION → BAD_REQUEST (уже нельзя отозвать)', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'IN_PREPARATION',
    })
    await expect(service.cancel(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('cancel из DRAFT → CANCELLED', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'stud', status: 'DRAFT' })
    await service.cancel(student, 'a1')
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    )
  })

  it('resubmit с незамёненными документами → BAD_REQUEST', async () => {
    const { service, application, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
    })
    applicationDocument.count.mockResolvedValue(1) // остались REPLACEMENT_REQUIRED
    await expect(service.resubmit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('чужая заявка → WRONG_SCOPE', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'other', status: 'DRAFT' })
    await expect(service.cancel(student, 'a1')).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })
})
