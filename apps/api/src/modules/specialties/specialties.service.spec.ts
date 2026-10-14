import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { SpecialtiesService } from './specialties.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const admin: JwtPayload = {
  sub: 'ua-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup() {
  const prisma = {
    specialty: {
      findUnique: jest.fn().mockResolvedValue({ id: 'sp-1', universityId: 'uni-1' }),
      update: jest.fn().mockResolvedValue({ id: 'sp-1', name: 'Информатика' }),
      delete: jest.fn(),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new SpecialtiesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma, audit }
}

describe('SpecialtiesService.update', () => {
  it('переименовывает специальность своего вуза, обрезая пробелы', async () => {
    const { service, prisma } = setup()
    await service.update(admin, 'sp-1', { name: '  Информатика ' }, ctx)
    expect(prisma.specialty.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sp-1' }, data: { name: 'Информатика' } }),
    )
  })

  it('специальность другого вуза — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.specialty.findUnique.mockResolvedValue({ id: 'sp-1', universityId: 'uni-2' })
    await expect(service.update(admin, 'sp-1', { name: 'X' }, ctx)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(prisma.specialty.update).not.toHaveBeenCalled()
  })

  it('такое название уже есть — CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.specialty.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('u', { code: 'P2002', clientVersion: '6' }),
    )
    await expect(service.update(admin, 'sp-1', { name: 'Дубль' }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})
