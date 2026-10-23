import { Role } from '@studenthub/shared-types'
import { matchVacancy } from '@studenthub/shared-schemas'
import { VacanciesService } from './vacancies.service'
import { CareerAccessService } from './career-access.service'
import type { CareerNotifier } from './career-notifier'
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
    vacancy: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vacancyUniversityReview: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const prisma = {
    vacancy: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'v-1', status: 'DRAFT', salaryMin: null, salaryMax: null }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'v-1' }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vacancyUniversityReview: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const access = {
    requireCompany: jest.fn().mockReturnValue('co-1'),
    assertCompanyActive: jest.fn().mockResolvedValue(undefined),
    allowedUniversityIds: jest.fn().mockResolvedValue(allowedUniversities),
  }
  // Уведомления компании о решениях вуза: сборка и доставка — в career-notifier.spec.ts.
  const notifier = { vacancyDecided: jest.fn().mockResolvedValue(undefined) }
  const service = new VacanciesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    access as unknown as CareerAccessService,
    notifier as unknown as CareerNotifier,
  )
  return { service, prisma, tx, audit, access, notifier }
}

describe('VacanciesService — заблокированная компания', () => {
  it('не создаёт, не правит и не публикует вакансии — блокировка перекрывает допуски', async () => {
    const { service, prisma, tx, access } = setup(['uni-1'])
    access.assertCompanyActive.mockRejectedValue(new AppException('FORBIDDEN', 'Заблокирована'))
    const input = {
      title: 'Стажёр',
      description: 'x'.repeat(50),
      employmentType: 'INTERNSHIP' as const,
      workFormat: 'REMOTE' as const,
      experienceLevel: 'NO_EXPERIENCE' as const,
      skills: [],
      languages: [],
    }

    await expect(service.create(employer, input, ctx)).rejects.toBeInstanceOf(AppException)
    await expect(service.update(employer, 'v-1', { title: 'Новое' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
    await expect(service.publish(employer, 'v-1', ctx)).rejects.toBeInstanceOf(AppException)
    expect(prisma.vacancy.create).not.toHaveBeenCalled()
    expect(tx.vacancy.update).not.toHaveBeenCalled()
    expect(tx.vacancy.updateMany).not.toHaveBeenCalled()
  })
})

describe('VacanciesService — публикация', () => {
  it('создаёт по строке модерации на каждый допустивший вуз', async () => {
    const { service, tx } = setup(['uni-1', 'uni-2'])

    await service.publish(employer, 'v-1', ctx)

    expect(tx.vacancyUniversityReview.createMany).toHaveBeenCalledWith({
      data: [
        { vacancyId: 'v-1', universityId: 'uni-1', status: 'PENDING' },
        { vacancyId: 'v-1', universityId: 'uni-2', status: 'PENDING' },
      ],
      // Вуз, где строка уже есть, свою строку сохраняет — с прежним решением.
      skipDuplicates: true,
    })
    expect(tx.vacancy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'v-1', status: 'DRAFT', deletedAt: null },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    )
  })

  it('повторная публикация возвращает на модерацию только отклонённое, одобрения не трогает', async () => {
    const { service, tx, prisma } = setup(['uni-1', 'uni-2'])
    prisma.vacancy.findFirst.mockResolvedValue({
      id: 'v-1',
      status: 'PUBLISHED',
      salaryMin: null,
      salaryMax: null,
    })

    await service.publish(employer, 'v-1', ctx)

    // Вуз, вернувший допуск, рассматривает вакансию заново; одобрившие — не теряют одобрения.
    expect(tx.vacancyUniversityReview.updateMany).toHaveBeenCalledTimes(1)
    expect(tx.vacancyUniversityReview.updateMany).toHaveBeenCalledWith({
      where: { vacancyId: 'v-1', universityId: { in: ['uni-1', 'uni-2'] }, status: 'REJECTED' },
      data: { status: 'PENDING', reason: null, decidedById: null, decidedAt: null },
    })
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

describe('VacanciesService — правка опубликованной вакансии', () => {
  // Вакансия в том виде, в каком её одобрил вуз.
  const approved = {
    title: 'Frontend-стажёр',
    description: 'x'.repeat(50),
    employmentType: 'INTERNSHIP',
    workFormat: 'REMOTE',
    experienceLevel: 'NO_EXPERIENCE',
    city: null,
    salaryMin: 100_000,
    salaryMax: 200_000,
    salaryCurrency: 'KZT',
    skills: ['React', 'TypeScript'],
    languages: ['ru'],
  }

  it('правка текста одобренной вакансии возвращает её на модерацию тем же шагом', async () => {
    const { service, prisma, tx } = setup()
    prisma.vacancy.findFirst.mockResolvedValue(approved)

    await service.update(
      employer,
      'v-1',
      { description: 'Пишите на мой telegram, оплата вперёд' },
      ctx,
    )

    // Одобрение снимается в той же транзакции, что и запись текста: иначе между ними новый
    // текст уже висел бы на витрине с чужим одобрением.
    expect(tx.vacancy.update).toHaveBeenCalled()
    expect(tx.vacancyUniversityReview.updateMany).toHaveBeenCalledWith({
      where: { vacancyId: 'v-1', status: 'APPROVED' },
      data: { status: 'PENDING', reason: null, decidedById: null, decidedAt: null },
    })
  })

  it('смена условий тоже содержательна: зарплата, формат, навыки', async () => {
    const edits = [
      { salaryMax: 900_000 },
      { workFormat: 'ONSITE' as const },
      { skills: ['React', 'TypeScript', 'Ссылка на оплату'] },
    ]
    for (const edit of edits) {
      const { service, prisma, tx } = setup()
      prisma.vacancy.findFirst.mockResolvedValue(approved)

      await service.update(employer, 'v-1', edit, ctx)

      expect(tx.vacancyUniversityReview.updateMany).toHaveBeenCalledTimes(1)
    }
  })

  it('форма с прежними значениями и перенос срока модерацию не сбрасывают', async () => {
    const { service, prisma, tx } = setup()
    prisma.vacancy.findFirst.mockResolvedValue(approved)

    // Форма присылает вакансию целиком — без изменений одобрение должно остаться.
    await service.update(
      employer,
      'v-1',
      {
        title: approved.title,
        skills: [...approved.skills],
        salaryMin: approved.salaryMin,
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
      },
      ctx,
    )

    expect(tx.vacancy.update).toHaveBeenCalled()
    expect(tx.vacancyUniversityReview.updateMany).not.toHaveBeenCalled()
  })

  it('закрытую вакансию править нельзя — и на модерацию она не возвращается', async () => {
    const { service, prisma, tx } = setup()
    prisma.vacancy.findFirst.mockResolvedValue({ ...approved, status: 'CLOSED' })

    await expect(
      service.update(employer, 'v-1', { description: 'y'.repeat(50) }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(tx.vacancy.update).not.toHaveBeenCalled()
    expect(tx.vacancyUniversityReview.updateMany).not.toHaveBeenCalled()
  })

  it('правка пишется с условием «не закрыта» — параллельное закрытие не обойти', async () => {
    const { service, prisma, tx } = setup()
    prisma.vacancy.findFirst.mockResolvedValue({ ...approved, status: 'PUBLISHED' })

    await service.update(employer, 'v-1', { title: 'Frontend-стажёр (React)' }, ctx)

    expect(tx.vacancy.update.mock.calls[0][0].where).toEqual({
      id: 'v-1',
      status: { not: 'CLOSED' },
    })
  })

  it('чужую вакансию править нельзя', async () => {
    const { service, prisma, tx } = setup()
    prisma.vacancy.findFirst.mockResolvedValue(null)

    await expect(service.update(employer, 'v-1', { title: 'Чужая' }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
    expect(tx.vacancy.update).not.toHaveBeenCalled()
  })
})

describe('VacanciesService — просмотры', () => {
  it('просмотр считается у студента, но не у сотрудника вуза', async () => {
    const { service, prisma } = setup()
    prisma.vacancy.findFirst.mockResolvedValue({ id: 'v-1' })

    await service.byIdForStudent(student(), 'v-1')
    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { views: { increment: 1 } },
    })

    prisma.vacancy.update.mockClear()
    await service.byIdForStudent(staff(), 'v-1')
    expect(prisma.vacancy.update).not.toHaveBeenCalled()
  })
})

describe('VacanciesService — фильтр зарплаты', () => {
  it('«от N» учитывает и вакансии без верхней границы', async () => {
    const { service, prisma } = setup()
    await service.search(student(), {
      page: 1,
      limit: 20,
      sort: 'publishedAt',
      order: 'desc',
      salaryFrom: 300_000,
    })
    const where = prisma.vacancy.findMany.mock.calls[0][0].where
    expect(where.AND).toContainEqual({
      OR: [{ salaryMax: { gte: 300_000 } }, { salaryMax: null, salaryMin: { gte: 300_000 } }],
    })
    expect(where).not.toHaveProperty('salaryMax')
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

  it('вакансия компании с истёкшим или отозванным допуском в вуз не показывается', async () => {
    const { service, prisma } = setup()

    await service.search(student('uni-7'), query)
    await expect(service.byIdForStudent(student('uni-7'), 'v-1')).resolves.toBeDefined()

    // Одобрение вуза не переживает конец допуска: условие на допуск — в той же выборке.
    const activeAccess = {
      company: {
        universityAccess: {
          some: {
            universityId: 'uni-7',
            status: 'APPROVED',
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          },
        },
      },
    }
    expect(prisma.vacancy.findMany.mock.calls[0][0].where).toMatchObject(activeAccess)
    expect(prisma.vacancy.findFirst.mock.calls[0][0].where).toMatchObject(activeAccess)
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
      status: 'PENDING',
      vacancy: { title: 'Стажёр-аналитик', companyId: 'co-1' },
    })

    await service.decide(staff(), 'r-1', { status: 'REJECTED', reason: 'не по профилю' }, ctx)

    expect(prisma.vacancyUniversityReview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'REJECTED',
          reason: 'не по профилю',
          decidedById: 'adm-1',
        }),
      }),
    )
  })

  // D-F28: компания узнавала о решении по вакансии, только заглянув в кабинет.
  it('решение уходит компании уведомлением; проигравшее гонку — нет', async () => {
    const { service, prisma, notifier } = setup()
    prisma.vacancyUniversityReview.findUnique.mockResolvedValue({
      id: 'r-1',
      universityId: 'uni-1',
      vacancyId: 'v-1',
      status: 'PENDING',
      vacancy: { title: 'Стажёр-аналитик', companyId: 'co-1' },
    })

    await service.decide(staff(), 'r-1', { status: 'REJECTED', reason: 'не по профилю' }, ctx)

    const decidedAt = prisma.vacancyUniversityReview.updateMany.mock.calls[0][0].data.decidedAt
    expect(notifier.vacancyDecided).toHaveBeenCalledWith({
      reviewId: 'r-1',
      companyId: 'co-1',
      vacancyTitle: 'Стажёр-аналитик',
      universityId: 'uni-1',
      status: 'REJECTED',
      reason: 'не по профилю',
      decidedAt,
    })

    notifier.vacancyDecided.mockClear()
    prisma.vacancyUniversityReview.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      service.decide(staff(), 'r-1', { status: 'APPROVED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
    expect(notifier.vacancyDecided).not.toHaveBeenCalled()
  })
})

describe('VacanciesService — переходы по графу (D-F29)', () => {
  const review = (status: string) => ({
    id: 'r-1',
    universityId: 'uni-1',
    vacancyId: 'v-1',
    status,
    vacancy: { title: 'Стажёр-аналитик', companyId: 'co-1' },
  })

  it('отклонённое (в т.ч. отзывом допуска) решение вуз обратно не одобряет → 409', async () => {
    const { service, prisma, audit } = setup()
    prisma.vacancyUniversityReview.findUnique.mockResolvedValue(review('REJECTED'))
    const err = (await service
      .decide(staff(), 'r-1', { status: 'APPROVED' }, ctx)
      .catch((e: unknown) => e)) as AppException
    expect(err.code).toBe('CONFLICT')
    expect(prisma.vacancyUniversityReview.updateMany).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('одобрение пишется только при действующем допуске и опубликованной вакансии', async () => {
    const { service, prisma } = setup()
    prisma.vacancyUniversityReview.findUnique.mockResolvedValue(review('PENDING'))
    await service.decide(staff(), 'r-1', { status: 'APPROVED' }, ctx)
    const where = prisma.vacancyUniversityReview.updateMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      id: 'r-1',
      status: 'PENDING',
      vacancy: {
        deletedAt: null,
        status: 'PUBLISHED',
        company: { universityAccess: { some: { universityId: 'uni-1', status: 'APPROVED' } } },
      },
    })
  })

  it('параллельное решение или отзыв допуска между чтением и записью → 409, без аудита', async () => {
    const { service, prisma, audit } = setup()
    prisma.vacancyUniversityReview.findUnique.mockResolvedValue(review('PENDING'))
    prisma.vacancyUniversityReview.updateMany.mockResolvedValue({ count: 0 })
    const err = (await service
      .decide(staff(), 'r-1', { status: 'APPROVED' }, ctx)
      .catch((e: unknown) => e)) as AppException
    expect(err.code).toBe('CONFLICT')
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('статус вакансии — только по графу: DRAFT → PAUSED и публикация закрытой → 409', async () => {
    const draft = setup()
    const pause = (await draft.service
      .setStatus(employer, 'v-1', 'PAUSED', ctx)
      .catch((e: unknown) => e)) as AppException
    expect(pause.code).toBe('CONFLICT')
    expect(draft.prisma.vacancy.updateMany).not.toHaveBeenCalled()

    const closed = setup()
    closed.prisma.vacancy.findFirst.mockResolvedValue({ id: 'v-1', status: 'CLOSED' })
    const publish = (await closed.service
      .publish(employer, 'v-1', ctx)
      .catch((e: unknown) => e)) as AppException
    expect(publish.code).toBe('CONFLICT')
    expect(closed.tx.vacancy.updateMany).not.toHaveBeenCalled()
  })

  it('пауза опубликованной: условие на прочитанный статус в записи; гонка → 409', async () => {
    const { service, prisma } = setup()
    prisma.vacancy.findFirst.mockResolvedValue({ id: 'v-1', status: 'PUBLISHED' })
    prisma.vacancy.updateMany.mockResolvedValue({ count: 0 })
    const err = (await service
      .setStatus(employer, 'v-1', 'PAUSED', ctx)
      .catch((e: unknown) => e)) as AppException
    expect(prisma.vacancy.updateMany).toHaveBeenCalledWith({
      where: { id: 'v-1', status: 'PUBLISHED', deletedAt: null },
      data: { status: 'PAUSED' },
    })
    expect(err.code).toBe('CONFLICT')
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
