import { Role } from '@studenthub/shared-types'
import { CareerAnalyticsService } from './career-analytics.service'
import { CareerAccessService } from './career-access.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const staff = (universityId: string | null = 'uni-1'): JwtPayload => ({
  sub: 'adm-1',
  role: Role.UNIVERSITY_ADMIN,
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

const group = (rows: Array<[string, number]>) =>
  rows.map(([status, n]) => ({ status, _count: { _all: n } }))

function setup(over: Record<string, unknown> = {}) {
  const prisma = {
    companyUniversityAccess: {
      groupBy: jest.fn().mockResolvedValue(group([['APPROVED', 3]])),
    },
    vacancyUniversityReview: {
      groupBy: jest.fn().mockResolvedValue(group([['APPROVED', 5]])),
    },
    careerApplication: {
      groupBy: jest.fn().mockResolvedValue(
        group([
          ['SUBMITTED', 50],
          ['INTERVIEW', 10],
          ['OFFER', 4],
          ['HIRED', 2],
          ['REJECTED', 34],
        ]),
      ),
    },
    careerProfile: { count: jest.fn().mockResolvedValue(120) },
    user: { count: jest.fn().mockResolvedValue(400) },
    vacancy: {
      groupBy: jest.fn().mockResolvedValue(group([['PUBLISHED', 4]])),
      aggregate: jest.fn().mockResolvedValue({ _sum: { views: 1000 } }),
    },
    ...over,
  }
  const access = { requireCompany: jest.fn().mockReturnValue('co-1') }
  const service = new CareerAnalyticsService(
    prisma as unknown as PrismaService,
    access as unknown as CareerAccessService,
  )
  return { service, prisma }
}

describe('CareerAnalyticsService — вуз', () => {
  it('считает только свой вуз — скоуп берётся из токена', async () => {
    const { service, prisma } = setup()

    await service.forUniversity(staff('uni-9'))

    expect(prisma.careerApplication.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { universityId: 'uni-9' } }),
    )
  })

  it('доли считаются от общего числа откликов', async () => {
    const { service } = setup()

    const result = await service.forUniversity(staff())

    // 100 откликов всего: 10 интервью, 4 оффера, 2 найма.
    expect(result.rates.interview).toBe(10)
    expect(result.rates.offer).toBe(4)
    expect(result.rates.hired).toBe(2)
  })

  it('при нулевом знаменателе доля — null, а не ноль', async () => {
    const { service } = setup({ careerApplication: { groupBy: jest.fn().mockResolvedValue([]) } })

    const result = await service.forUniversity(staff())

    // «Ещё нечего считать» и «0%» — разные вещи, и на графике это видно.
    expect(result.rates.hired).toBeNull()
  })

  it('видимость профилей показывается долей от всех студентов', async () => {
    const { service } = setup()
    const result = await service.forUniversity(staff())
    expect(result.profiles).toEqual({ visible: 120, total: 400 })
  })

  it('сотрудник без вуза в токене получает WRONG_SCOPE', async () => {
    const { service } = setup()
    await expect(service.forUniversity(staff(null))).rejects.toBeInstanceOf(AppException)
  })

  it('персональных данных в сводке нет — только агрегаты', async () => {
    const { service } = setup()
    const result = await service.forUniversity(staff())
    const serialized = JSON.stringify(result)
    // Вуз имеет право видеть ход трудоустройства, но не список скрывших профиль студентов.
    expect(serialized).not.toContain('firstName')
    expect(serialized).not.toContain('email')
  })
})

describe('CareerAnalyticsService — компания', () => {
  it('конверсия отклика считается от просмотров вакансий', async () => {
    const { service } = setup()

    const result = await service.forCompany(employer)

    // 100 откликов на 1000 просмотров.
    expect(result.views).toBe(1000)
    expect(result.rates.apply).toBe(10)
  })

  it('своя компания берётся из токена, а не из запроса', async () => {
    const { service, prisma } = setup()
    await service.forCompany(employer)
    expect(prisma.careerApplication.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1' } }),
    )
  })
})
