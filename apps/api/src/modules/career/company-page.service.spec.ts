import { Role } from '@studenthub/shared-types'
import { CompanyPageService } from './company-page.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const CONFIG: Record<string, unknown> = {
  MINIO_BUCKET_PROFILE_COVERS: 'profile-covers',
  MINIO_USE_SSL: false,
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: 9000,
}
const OWN = 'http://localhost:9000/profile-covers/'

function employer(sub = 'emp-1'): JwtPayload {
  return {
    sub,
    role: Role.EMPLOYER,
    universityId: null,
    facultyId: null,
    groupId: null,
    companyId: 'co-1',
  }
}

function setup(memberRole = 'OWNER', prev: { logoUrl: string | null } = { logoUrl: null }) {
  const prisma = {
    company: {
      findFirst: jest.fn().mockResolvedValue({ id: 'co-1', name: 'ТОО «Ромашка»' }),
      findUnique: jest.fn().mockResolvedValue({ ...prev, coverUrl: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    companyMember: {
      findUnique: jest.fn().mockResolvedValue({ companyId: 'co-1', role: memberRole }),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const access = {
    assertCanViewCompany: jest.fn().mockResolvedValue(undefined),
    requireCompany: jest.fn((v: JwtPayload) => v.companyId),
  }
  const files = {
    putAuxImage: jest.fn().mockResolvedValue('new.webp'),
    removeRawObject: jest.fn().mockResolvedValue(undefined),
  }
  const config = { get: (k: string) => CONFIG[k] }
  const service = new CompanyPageService(
    prisma as never,
    audit as never,
    access as never,
    files as never,
    config as never,
  )
  return { service, prisma, audit, access, files }
}

describe('CompanyPageService', () => {
  it('страница — после проверки допуска; isMember по токену', async () => {
    const { service, access } = setup()
    const page = await service.page(employer(), 'co-1')
    expect(access.assertCanViewCompany).toHaveBeenCalledWith(employer(), 'co-1')
    expect(page.isMember).toBe(true)
  })

  it('нет допуска — отказ проверки допуска пробрасывается, компания не читается', async () => {
    const { service, prisma, access } = setup()
    access.assertCanViewCompany.mockRejectedValue(new AppException('NOT_FOUND', 'нет'))
    await expect(service.page(employer(), 'co-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.company.findFirst).not.toHaveBeenCalled()
  })

  it('логотип: ссылку строит сервер, прежний свой объект удаляется', async () => {
    const { service, prisma, files, audit } = setup('OWNER', { logoUrl: `${OWN}old.webp` })
    await expect(service.setImage(employer(), 'logo', Buffer.from('x'), ctx)).resolves.toEqual({
      url: `${OWN}new.webp`,
    })
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      data: { logoUrl: `${OWN}new.webp` },
    })
    expect(files.removeRawObject).toHaveBeenCalledWith('profile-covers', 'old.webp')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_logo_updated' }),
    )
  })

  it('чужая ссылка в старом logoUrl объект в бакете не трогает', async () => {
    const { service, files } = setup('OWNER', { logoUrl: 'https://evil.example/x.png' })
    await service.removeImage(employer(), 'logo', ctx)
    expect(files.removeRawObject).not.toHaveBeenCalled()
  })

  it('рекрутёр картинки компании не меняет', async () => {
    const { service, files } = setup('RECRUITER')
    const err = await service
      .setImage(employer(), 'cover', Buffer.from('x'), ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('FORBIDDEN')
    expect(files.putAuxImage).not.toHaveBeenCalled()
  })
})
