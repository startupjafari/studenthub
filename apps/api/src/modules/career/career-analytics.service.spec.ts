import type Redis from 'ioredis'
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

/** Платформенная роль: своего вуза нет, область данных выбирается параметром. */
const platform: JwtPayload = {
  sub: 'plt-1',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}

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

// Сырой SQL проверяется на реальной схеме (запросы исполняются). Здесь — логика вокруг
// него: раскладка строк, bigint → number, прочерки и кэш. Поэтому мок роутится по тексту
// запроса: в одном вызове forUniversity их четыре, и подменять их «по порядку» хрупко.
const REACHED = {
  submitted: 100n,
  viewed: 70n,
  shortlisted: 30n,
  interview: 10n,
  offer: 4n,
  hired: 2n,
}

function rawRouter(over: Record<string, unknown[]> = {}) {
  return jest.fn((strings: TemplateStringsArray) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings)
    if (sql.includes('WITH depth')) return Promise.resolve(over.reached ?? [REACHED])
    if (sql.includes('percentile_cont')) return Promise.resolve(over.median ?? [{ median: 12.4 }])
    if (sql.includes('WITH weeks'))
      return Promise.resolve(
        over.weekly ?? [
          { bucket: new Date('2026-08-31T00:00:00.000Z'), submitted: 7n, interview: 2n, hired: 0n },
          { bucket: new Date('2026-09-07T00:00:00.000Z'), submitted: 0n, interview: 0n, hired: 1n },
        ],
      )
    if (sql.includes('WITH demand'))
      return Promise.resolve(
        over.skills ?? [{ skill: 'sql', demand: 9n, supply: 3n, vacancies_total: 12n }],
      )
    return Promise.resolve([])
  })
}

function setup(over: Record<string, unknown> = {}, raw: Record<string, unknown[]> = {}) {
  const queryRaw = rawRouter(raw)
  const prisma = {
    $queryRaw: queryRaw,
    companyUniversityAccess: {
      groupBy: jest.fn().mockResolvedValue(group([['APPROVED', 3]])),
      count: jest.fn().mockResolvedValue(1),
    },
    vacancyUniversityReview: {
      groupBy: jest.fn().mockResolvedValue(group([['APPROVED', 5]])),
      count: jest.fn().mockResolvedValue(2),
      findFirst: jest.fn().mockResolvedValue(null),
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
      count: jest.fn().mockResolvedValue(6),
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
  // Кэш по умолчанию промахивается: тесты проверяют сам расчёт.
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }
  const service = new CareerAnalyticsService(
    prisma as unknown as PrismaService,
    access as unknown as CareerAccessService,
    redis as unknown as Redis,
  )
  return { service, prisma, redis, queryRaw }
}

describe('CareerAnalyticsService — вуз', () => {
  it('считает только свой вуз — скоуп берётся из токена', async () => {
    const { service, prisma } = setup()

    await service.forUniversity(staff('uni-9'))

    expect(prisma.careerApplication.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { universityId: 'uni-9' } }),
    )
  })

  it('воронка считается по достигнутым стадиям, а не по текущему статусу', async () => {
    const { service } = setup()

    const result = await service.forUniversity(staff())

    // В текущих статусах «отправлено» лежит 50 штук, но отправлены были все 100:
    // отказ после интервью и найм тоже когда-то были отправлены.
    expect(result.funnel.SUBMITTED).toBe(50)
    expect(result.reached.SUBMITTED).toBe(100)
    expect(result.reached.INTERVIEW).toBe(10)
  })

  it('доли считаются от дошедших до шага, а не от остатков', async () => {
    const { service } = setup()

    const result = await service.forUniversity(staff())

    // 100 отправленных: 10 дошли до интервью, 4 до оффера, 2 до найма.
    expect(result.rates.interview).toBe(10)
    expect(result.rates.offer).toBe(4)
    expect(result.rates.hired).toBe(2)
  })

  it('при нулевом знаменателе доля — null, а не ноль', async () => {
    const { service } = setup({}, { reached: [] })

    const result = await service.forUniversity(staff())

    // «Ещё нечего считать» и «0%» — разные вещи, и на графике это видно.
    expect(result.reached.SUBMITTED).toBe(0)
    expect(result.rates.hired).toBeNull()
  })

  it('возраст очереди — прочерк, когда на модерации пусто', async () => {
    const { service } = setup()
    const result = await service.forUniversity(staff())
    // «Очередь пуста» и «ждут ноль дней» — разные вещи.
    expect(result.queue.oldestPendingDays).toBeNull()
  })

  it('возраст старейшей заявки считается в днях', async () => {
    const { service } = setup({
      vacancyUniversityReview: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(3),
        findFirst: jest
          .fn()
          .mockResolvedValue({ createdAt: new Date(Date.now() - 6 * 86_400_000 - 1000) }),
      },
    })

    const result = await service.forUniversity(staff())

    expect(result.queue.vacanciesPending).toBe(3)
    expect(result.queue.oldestPendingDays).toBe(6)
    expect(result.queue.medianDecisionHours).toBe(12)
  })

  it('ряд по неделям раскладывается в параллельные массивы', async () => {
    const { service } = setup()

    const result = await service.forUniversity(staff())

    expect(result.weekly.weeks).toHaveLength(2)
    expect(result.weekly.submitted).toEqual([7, 0])
    expect(result.weekly.hired).toEqual([0, 1])
  })

  it('навыки отдаются числами, а не bigint — иначе ответ не сериализуется', async () => {
    const { service } = setup()

    const result = await service.forUniversity(staff())

    // Доли считаются от своих знаменателей: спрос — от вакансий, предложение — от студентов.
    // Штуки этих величин несравнимы, доли сравнимы.
    expect(result.skills).toEqual([
      { skill: 'sql', demand: 9, supply: 3, demandShare: 75, supplyShare: 1 },
    ])
    expect(() => JSON.stringify(result)).not.toThrow()
  })

  it('доля навыка — прочерк, когда одобренных вакансий нет вовсе', async () => {
    const { service } = setup(
      {},
      { skills: [{ skill: 'sql', demand: 0n, supply: 3n, vacancies_total: 0n }] },
    )

    const result = await service.forUniversity(staff())

    expect(result.skills[0]?.demandShare).toBeNull()
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

  it('готовая сводка берётся из кэша и не идёт в базу', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockResolvedValue(JSON.stringify({ cached: true }))

    const result = await service.forUniversity(staff())

    expect(result).toEqual({ cached: true })
    expect(prisma.careerApplication.groupBy).not.toHaveBeenCalled()
  })

  it('недоступный Redis не ломает сводку — считаем напрямую', async () => {
    const { service, redis } = setup()
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'))
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'))

    // Дашборд без кэша лучше, чем дашборд, молча переставший работать.
    await expect(service.forUniversity(staff())).resolves.toMatchObject({ reached: { HIRED: 2 } })
  })

  it('кэш разведён по вузам — платформенная роль переключает область данных', async () => {
    const { service, redis } = setup()

    await service.forUniversity(platform, 'uni-7')

    expect(redis.get).toHaveBeenCalledWith('analytics:career:university:uni-7')
  })

  it('сотрудник вуза не может запросить чужой вуз параметром', async () => {
    const { service } = setup()
    // Скоуп берётся из токена; явно переданный чужой вуз — WRONG_SCOPE, а не «уточнение».
    await expect(service.forUniversity(staff('uni-1'), 'uni-7')).rejects.toBeInstanceOf(
      AppException,
    )
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
