import { Role } from '@studenthub/shared-types'
import { ApplicationDocumentsService } from './application-documents.service'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { FileService } from '../files/file.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const student: JwtPayload = {
  sub: 'stud',
  role: Role.STUDENT,
  universityId: 'uni',
  facultyId: 'fac',
  groupId: 'g',
}
const dean: JwtPayload = {
  sub: 'dean',
  role: Role.DEAN,
  universityId: 'uni',
  facultyId: 'fac',
  groupId: null,
}

function setup() {
  const application = { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) }
  const serviceRequirement = { findFirst: jest.fn() }
  const document = { findFirst: jest.fn() }
  const applicationDocument = {
    upsert: jest.fn().mockResolvedValue({ id: 'ad1' }),
    deleteMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  }
  const applicationEvent = { create: jest.fn().mockResolvedValue({}) }
  const file = { findFirst: jest.fn() }
  const tx = {
    application,
    serviceRequirement,
    document,
    applicationDocument,
    applicationEvent,
    file,
  }
  const prisma = {
    ...tx,
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  }
  const files = { getPresignedUrl: jest.fn().mockResolvedValue('https://url') }
  const service = new ApplicationDocumentsService(
    prisma as unknown as PrismaService,
    new ApplicationPolicy(),
    files as unknown as FileService,
  )
  return {
    service,
    application,
    serviceRequirement,
    document,
    applicationDocument,
    applicationEvent,
  }
}

describe('ApplicationDocumentsService.attach', () => {
  it('чужая заявка → WRONG_SCOPE', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'other',
      status: 'DRAFT',
      serviceId: 's',
    })
    await expect(service.attach(student, 'a1', 'r1', 'd1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })

  it('нередактируемый статус (SUBMITTED) → BAD_REQUEST', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'SUBMITTED',
      serviceId: 's',
    })
    await expect(service.attach(student, 'a1', 'r1', 'd1')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('документ не в хранилище студента → NOT_FOUND', async () => {
    const { service, application, serviceRequirement, document } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'DRAFT',
      serviceId: 's',
    })
    serviceRequirement.findFirst.mockResolvedValue({ id: 'r1', titleRu: 'ID' })
    document.findFirst.mockResolvedValue(null)
    await expect(service.attach(student, 'a1', 'r1', 'd1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('успех → upsert PENDING со снимком названия', async () => {
    const { service, application, serviceRequirement, document, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'DRAFT',
      serviceId: 's',
    })
    serviceRequirement.findFirst.mockResolvedValue({ id: 'r1', titleRu: 'ID' })
    document.findFirst.mockResolvedValue({ id: 'd1', title: 'Паспорт' })
    await service.attach(student, 'a1', 'r1', 'd1')
    expect(applicationDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'PENDING', snapshotTitle: 'Паспорт' }),
      }),
    )
  })
})

describe('ApplicationDocumentsService.review', () => {
  it('request-replacement без причины → BAD_REQUEST', async () => {
    const { service, application, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
      status: 'IN_REVIEW',
    })
    applicationDocument.findFirst.mockResolvedValue({ id: 'ad1', requirement: { titleRu: 'ID' } })
    await expect(service.review(dean, 'a1', 'ad1', 'request-replacement')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('accept → статус ACCEPTED', async () => {
    const { service, application, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
      status: 'IN_REVIEW',
    })
    applicationDocument.findFirst.mockResolvedValue({ id: 'ad1', requirement: { titleRu: 'ID' } })
    await service.review(dean, 'a1', 'ad1', 'accept')
    expect(applicationDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    )
  })

  it('студент не может review → FORBIDDEN', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
      status: 'IN_REVIEW',
    })
    await expect(service.review(student, 'a1', 'ad1', 'accept')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
