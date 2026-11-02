import { Role } from '@studenthub/shared-types'
import { UniversityPageService } from './university-page.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const CONFIG: Record<string, unknown> = {
  MINIO_BUCKET_PROFILE_COVERS: 'profile-covers',
  MINIO_USE_SSL: false,
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: 9000,
}

function user(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

function setup() {
  const prisma = {
    university: {
      findUnique: jest.fn().mockResolvedValue({ id: 'uni-1', logoUrl: null, coverUrl: null }),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const access = { assertCanViewUniversityPage: jest.fn().mockResolvedValue(undefined) }
  const files = {
    putAuxImage: jest.fn().mockResolvedValue('new.webp'),
    removeRawObject: jest.fn().mockResolvedValue(undefined),
  }
  const service = new UniversityPageService(
    prisma as never,
    audit as never,
    access as never,
    files as never,
    { get: (k: string) => CONFIG[k] } as never,
  )
  return { service, prisma, audit, access, files }
}

describe('UniversityPageService', () => {
  it('страница — после проверки доступа; права смотрящего по роли и вузу', async () => {
    const { service, access } = setup()
    const asModerator = await service.page(user(Role.UNIVERSITY_MODERATOR), 'uni-1')
    expect(access.assertCanViewUniversityPage).toHaveBeenCalled()
    expect(asModerator).toMatchObject({ canPublish: true, canEdit: false })
    const asAdmin = await service.page(user(Role.UNIVERSITY_ADMIN), 'uni-1')
    expect(asAdmin).toMatchObject({ canPublish: true, canEdit: true })
    const asStudent = await service.page(user(Role.STUDENT), 'uni-1')
    expect(asStudent).toMatchObject({ canPublish: false, canEdit: false })
  })

  it('правит страницу только админ своего вуза — вуз из токена', async () => {
    const { service, prisma } = setup()
    await service.update(user(Role.UNIVERSITY_ADMIN), { description: 'О вузе' }, ctx)
    expect(prisma.university.update).toHaveBeenCalledWith({
      where: { id: 'uni-1' },
      data: { description: 'О вузе' },
    })
    const err = await service
      .update(user(Role.UNIVERSITY_MODERATOR), { description: 'x' }, ctx)
      .catch((e: AppException) => e)
    expect((err as AppException).code).toBe('FORBIDDEN')
  })

  it('логотип: ссылку строит сервер', async () => {
    const { service, prisma } = setup()
    await expect(
      service.setImage(user(Role.UNIVERSITY_ADMIN), 'logo', Buffer.from('x'), ctx),
    ).resolves.toEqual({ url: 'http://localhost:9000/profile-covers/new.webp' })
    expect(prisma.university.update).toHaveBeenCalledWith({
      where: { id: 'uni-1' },
      data: { logoUrl: 'http://localhost:9000/profile-covers/new.webp' },
    })
  })
})
