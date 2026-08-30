import { Role } from '@studenthub/shared-types'
import { matchVacancy } from '@studenthub/shared-schemas'
import { VacanciesService } from './vacancies.service'
import { CareerAccessService } from './career-access.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const employer: JwtPayload = {
  sub: 'hr-1',
  role: Role.EMPLOYER,
  universityId: null,
  facultyId: null,
  groupId: null,
  companyId: 'co-1',
}

const student = (universityId: string | null = 'uni-1'): JwtPayload => ({
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId,
  facultyId: null,
  groupId: null,
})

const staff = (universityId: string | null = 'uni-1'): JwtPayload => ({
  sub: 'adm-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId,
  facultyId: null,
  groupId: null,
})

function setup(allowedUniversities: string[] = ['uni-1']) {
  const tx = {
    vacancy: { update: jest.fn() },
    vacancyUniversityReview: { upsert: jest.fn() },
  }
  const prisma = {
    vacancy: {
      findFirst: jest.fn().mockResolvedValue({ id: 'v-1', salaryMin: null, salaryMax: null }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'v-1' }),
      update: jest.fn(),
    },
    vacancyUniversityReview: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const access = {
    requireCompany: jest.fn().mockReturnValue('co-1'),
    allowedUniversityIds: jest.fn().mockResolvedValue(allowedUniversities),
  }
  const service = new VacanciesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    access as unknown as CareerAccessService,
  )
  return { service, prisma, tx, audit, access }
}

describe('VacanciesService — публикация', () => {
  it('создаёт по строке модерации на каждый допустивший вуз', async () => {
    const { service, tx } = setup(['uni-1', 'uni-2'])

    await service.publish(employer, 'v-1', ctx)

    expect(tx.vacancyUniversityReview.upsert).toHaveBeenCalledTimes(2)
    expect(tx.vacancy.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED' }) }),
    )
  })

  it('повторная публикация сбрасывает прежние решения вузов', async () => {
    const { service, tx } = setup(['uni-1'])

    await service.publish(employer, 'v-1', ctx)

    // Вуз одобрял конкретный текст, а не вакансию навсегда.
    expect(tx.vacancyUniversityReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'PENDING', reason: null, decidedAt: null }),
      }),
    )
  })

  it('без единого допуска публиковать нечего — отказ с объяснением', async () => {
    const { service } = setup([])
    await expect(service.publish(employer, 'v-1', ctx)).rejects.toBeInstanceOf(AppException)
  })

  it('чужую вакансию опубликовать нельзя', async () => {
    const { service, prisma } = setup()
    prisma.vacancy.findFirst.mockResolvedValue(null)
    await expect(service.publish(employer, 'v-1', ctx)).rejects.toBeInstanceOf(AppException)
  })

  it('вилка зарплаты наоборот отклоняется при создании', async () => {
    const { service } = setup()
    await expect(
      service.create(
        employer,
        {
          title: 'Frontend',
          description: 'x'.repeat(50),
          employmentType: 'INTERNSHIP',
          workFormat: 'REMOTE',
          experienceLevel: 'NO_EXPERIENCE',
          salaryMin: 900,
          salaryMax: 500,
          skills: [],
          languages: [],
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(AppException)
  })
})

describe('VacanciesService — видимость для студента', () => {
  const query = { page: 1, limit: 20, sort: 'publishedAt' as const, order: 'desc' as const }

  it('выборка ограничена вакансиями, одобренными вузом студента', async () => {
    const { service, prisma } = setup()

    await service.search(student('uni-7'), query)

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PUBLISHED',
          reviews: { some: { universityId: 'uni-7', status: 'APPROVED' } },
        }),
      }),
    )
  })

  it('поиск по тексту не теряется рядом с фильтром по сроку', async () => {
    const { service, prisma } = setup()

    await service.search(student(), { ...query, search: 'react' })

    // Оба условия-ИЛИ должны уехать в AND: иначе одно молча затирает другое.
    const where = prisma.vacancy.findMany.mock.calls[0]?.[0]?.where as { AND: unknown[] }
    expect(where.AND).toHaveLength(2)
  })

  it('студент без вуза в токене получает WRONG_SCOPE', async () => {
    const { service } = setup()
    await expect(service.search(student(null), query)).rejects.toBeInstanceOf(AppException)
  })

  it('вакансия, не одобренная вузом, недоступна и по прямой ссылке', async () => {
    const { service, prisma } = setup()
    prisma.vacancy.findFirst.mockResolvedValue(null)
    await expect(service.byIdForStudent(student(), 'v-1')).rejects.toBeInstanceOf(AppException)
  })
})

describe('VacanciesService — модерация вузом', () => {
  it('решение по вакансии чужого вуза отклоняется', async () => {
    const { service, prisma } = setup()
    prisma.vacancyUniversityReview.findUnique.mockResolvedValue({
      id: 'r-1',
      universityId: 'uni-OTHER',
      vacancyId: 'v-1',
    })
    await expect(
      service.decide(staff('uni-1'), 'r-1', { status: 'APPROVED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
    expect(prisma.vacancyUniversityReview.update).not.toHaveBeenCalled()
  })

  it('решение записывается с автором и временем', async () => {
    const { service, prisma } = setup()
    prisma.vacancyUniversityReview.findUnique.mockResolvedValue({
      id: 'r-1',
      universityId: 'uni-1',
      vacancyId: 'v-1',
    })

    await service.decide(staff(), 'r-1', { status: 'REJECTED', reason: 'не по профилю' }, ctx)

    expect(prisma.vacancyUniversityReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          reason: 'не по профилю',
          decidedById: 'adm-1',
        }),
      }),
    )
  })
})

describe('matchVacancy — совпадение вакансии и профиля', () => {
  const base = {
    vacancy: {
      skills: ['React', 'TypeScript'],
      employmentType: 'INTERNSHIP' as const,
      workFormat: 'REMOTE' as const,
      city: null,
    },
    profile: {
      skills: ['react', 'typescript'],
      employmentTypes: ['INTERNSHIP' as const],
      workFormats: ['REMOTE' as const],
      city: null,
      relocationReady: false,
    },
  }

  it('полное совпадение — сто', () => {
    expect(matchVacancy(base).score).toBe(100)
  })

  it('навыки сравниваются без учёта регистра', () => {
    expect(matchVacancy(base).matchedSkills).toEqual(['React', 'TypeScript'])
  })

  it('недостающие навыки перечислены — это и есть объяснение', () => {
    const result = matchVacancy({
      ...base,
      profile: { ...base.profile, skills: ['react'] },
    })
    expect(result.missingSkills).toEqual(['TypeScript'])
    expect(result.score).toBeLessThan(100)
  })

  it('вакансия без требований по навыкам не штрафует профиль', () => {
    const result = matchVacancy({
      vacancy: { ...base.vacancy, skills: [] },
      profile: { ...base.profile, skills: [] },
    })
    expect(result.score).toBe(100)
  })

  it('пустые предпочтения профиля не считаются несовпадением', () => {
    const result = matchVacancy({
      ...base,
      profile: { ...base.profile, employmentTypes: [], workFormats: [] },
    })
    expect(result.score).toBe(100)
  })

  it('удалённая вакансия снимает вопрос города', () => {
    const result = matchVacancy({
      vacancy: { ...base.vacancy, city: '750000000' },
      profile: { ...base.profile, city: '710000000' },
    })
    expect(result.score).toBe(100)
  })

  it('город из другого региона снижает совпадение, но не обнуляет', () => {
    const result = matchVacancy({
      vacancy: { ...base.vacancy, workFormat: 'ONSITE', city: '750000000' },
      profile: { ...base.profile, workFormats: ['ONSITE'], city: '710000000' },
    })
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(100)
  })

  it('готовность к переезду возвращает совпадение по городу', () => {
    const result = matchVacancy({
      vacancy: { ...base.vacancy, workFormat: 'ONSITE', city: '750000000' },
      profile: {
        ...base.profile,
        workFormats: ['ONSITE'],
        city: '710000000',
        relocationReady: true,
      },
    })
    expect(result.score).toBe(100)
  })
})
