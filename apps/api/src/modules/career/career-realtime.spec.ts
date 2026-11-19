import { CareerRealtime } from './career-realtime'
import type { CareerAccessService } from './career-access.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'

// Адреса сигнала career.changed (§9.2d).
function setup() {
  const prisma = {
    companyMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'hr-1' }, { userId: 'hr-2' }]),
    },
  }
  const gateway = { emitEventToRooms: jest.fn() }
  const access = { allowedUniversityIds: jest.fn().mockResolvedValue(['uni-1', 'uni-2']) }
  const live = new CareerRealtime(
    prisma as unknown as PrismaService,
    gateway as unknown as RealtimeGateway,
    access as unknown as CareerAccessService,
  )
  return { live, prisma, gateway, access }
}

describe('CareerRealtime', () => {
  it('черновик → только участникам компании, допуски не читаются', async () => {
    const { live, gateway, access, prisma } = setup()
    await live.vacancyForCompany('v-1', 'co-1', 'created')
    expect(prisma.companyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1' }, take: 100 }),
    )
    expect(access.allowedUniversityIds).not.toHaveBeenCalled()
    expect(gateway.emitEventToRooms).toHaveBeenCalledWith(
      ['user:hr-1', 'user:hr-2'],
      'career.changed',
      'v-1',
      { entity: 'vacancy', kind: 'created' },
    )
  })

  it('опубликованная → комнаты допустивших вузов и компания одной отправкой', async () => {
    const { live, gateway, access } = setup()
    await live.vacancyForUniversities('v-1', 'co-1', 'published')
    expect(access.allowedUniversityIds).toHaveBeenCalledWith('co-1')
    expect(gateway.emitEventToRooms).toHaveBeenCalledWith(
      ['university:uni-1', 'university:uni-2', 'user:hr-1', 'user:hr-2'],
      'career.changed',
      'v-1',
      { entity: 'vacancy', kind: 'published' },
    )
  })

  it('решение модератора → вуз решения и компания, без остальных вузов', async () => {
    const { live, gateway, access } = setup()
    await live.vacancyReviewed('v-1', 'co-1', 'uni-9')
    expect(access.allowedUniversityIds).not.toHaveBeenCalled()
    expect(gateway.emitEventToRooms).toHaveBeenCalledWith(
      ['university:uni-9', 'user:hr-1', 'user:hr-2'],
      'career.changed',
      'v-1',
      { entity: 'vacancy', kind: 'reviewed' },
    )
  })

  it('смена статуса отклика → автору и компании', async () => {
    const { live, gateway } = setup()
    await live.applicationStatusChanged('a-1', 'co-1', 'stu-1')
    expect(gateway.emitEventToRooms).toHaveBeenCalledWith(
      ['user:hr-1', 'user:hr-2', 'user:stu-1'],
      'career.changed',
      'a-1',
      { entity: 'application', kind: 'status' },
    )
  })

  it('сбой чтения адресатов или рассылки не бросает наружу', async () => {
    const { live, gateway, access } = setup()
    access.allowedUniversityIds.mockRejectedValue(new Error('нет Redis'))
    await expect(live.vacancyForUniversities('v-1', 'co-1', 'closed')).resolves.toBeUndefined()
    expect(gateway.emitEventToRooms).not.toHaveBeenCalled()

    gateway.emitEventToRooms.mockImplementation(() => {
      throw new Error('нет сервера')
    })
    await expect(live.applicationForCompany('a-1', 'co-1', 'submitted')).resolves.toBeUndefined()
  })
})
