import { Role } from '@studenthub/shared-types'
import { RoomService } from './rooms.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function setup() {
  const prisma = {
    room: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([[], 0]),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new RoomService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

function viewer(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

describe('RoomService — list: поиск и страницы', () => {
  it('search — подстрока названия без учёта регистра, вуз — из JWT', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.UNIVERSITY_ADMIN), {
      page: 2,
      limit: 100,
      // Чужой вуз в query у вуз-роли игнорируется: scope только из токена.
      universityId: 'uni-2',
      search: 'лаб',
    })
    const where = { universityId: 'uni-1', name: { contains: 'лаб', mode: 'insensitive' } }
    expect(prisma.room.findMany.mock.calls[0][0]).toMatchObject({ where, skip: 100, take: 100 })
    // Счётчик — по тому же фильтру, иначе пагинация показала бы пустые страницы.
    expect(prisma.room.count).toHaveBeenCalledWith({ where })
  })

  it('поиск складывается с фильтром назначения', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.PLATFORM_ADMIN), {
      page: 1,
      limit: 20,
      universityId: 'uni-9',
      kind: 'LAB',
      search: '2',
    })
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-9',
      kind: 'LAB',
      name: { contains: '2', mode: 'insensitive' },
    })
  })

  it('без search фильтра по названию нет', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.TEACHER), { page: 1, limit: 20 })
    expect(prisma.room.findMany.mock.calls[0][0].where).toEqual({ universityId: 'uni-1' })
  })

  it('последний ключ сортировки — id: одноимённые помещения не прыгают между страницами', async () => {
    const { service, prisma } = setup()
    await service.list(viewer(Role.UNIVERSITY_ADMIN), { page: 1, limit: 20 })
    expect(prisma.room.findMany.mock.calls[0][0].orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }])

    await service.list(viewer(Role.UNIVERSITY_ADMIN), {
      page: 1,
      limit: 20,
      sort: 'floor',
      order: 'desc',
    })
    expect(prisma.room.findMany.mock.calls[1][0].orderBy).toEqual([
      { floor: { sort: 'desc', nulls: 'last' } },
      { name: 'asc' },
      { id: 'asc' },
    ])
  })
})
