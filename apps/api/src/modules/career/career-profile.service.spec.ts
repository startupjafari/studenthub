import { Role } from '@studenthub/shared-types'
import { careerReadiness } from '@studenthub/shared-schemas'
import { CareerProfileService } from './career-profile.service'
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

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

/** Студент со всеми чувствительными полями заполненными — чтобы утечку было видно. */
function sourceUser(over: Record<string, unknown> = {}) {
  return {
    id: 'stu-1',
    firstName: 'Аружан',
    lastName: 'Оспанова',
    email: 'aruzhan@uni.kz',
    phone: '+7 700 000 00 00',
    gpa: 3.8,
    headline: 'Frontend-разработчик',
    country: 'KZ',
    specialty: 'Информационные системы',
    course: 3,
    graduationYear: 2027,
    skills: ['React', 'TypeScript'],
    languages: ['ru', 'en'],
    avatarUrl: null,
    avatarThumbUrl: null,
    universityId: 'uni-1',
    university: { name: 'Алатау' },
    careerProfile: {
      visibility: 'EMPLOYERS',
      employmentStatus: 'LOOKING',
      desiredPositions: ['Frontend'],
      employmentTypes: ['INTERNSHIP'],
      workFormats: ['REMOTE'],
      relocationReady: false,
      about: 'Ищу стажировку',
      readinessScore: 60,
      desiredSalaryMin: null,
      desiredSalaryMax: null,
      salaryCurrency: null,
    },
    portfolioItems: [
      {
        id: 'p-1',
        kind: 'PROJECT',
        title: 'Пет-проект',
        organization: null,
        description: null,
        url: null,
        startDate: null,
        endDate: null,
      },
    ],
    documents: [{ id: 'd-1', title: 'Сертификат курса', issuedBy: 'Алатау', issuedAt: new Date() }],
    ...over,
  }
}

function setup(user: Record<string, unknown> | null = sourceUser(), consents: string[] = []) {
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(user) },
    careerProfile: { update: jest.fn(), upsert: jest.fn() },
    careerConsent: {
      findMany: jest.fn().mockResolvedValue(consents.map((field) => ({ field }))),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const access = {
    requireCompany: jest.fn().mockReturnValue('co-1'),
    assertCanAccessUniversity: jest.fn().mockResolvedValue(undefined),
  }
  const service = new CareerProfileService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    access as unknown as CareerAccessService,
  )
  return { service, prisma, audit, access }
}

describe('CareerProfileService — карточка для работодателя', () => {
  it('без согласия GPA, телефон и email не отдаются', async () => {
    const { service } = setup(sourceUser(), [])

    const card = await service.cardForEmployer(employer, 'stu-1', ctx)

    expect(card.gpa).toBeNull()
    expect(card.phone).toBeNull()
    expect(card.email).toBeNull()
    // Остальное при этом видно — иначе карточка бесполезна.
    expect(card.skills).toEqual(['React', 'TypeScript'])
  })

  it('согласие открывает ровно то поле, на которое выдано', async () => {
    const { service } = setup(sourceUser(), ['GPA'])

    const card = await service.cardForEmployer(employer, 'stu-1', ctx)

    expect(card.gpa).toBe(3.8)
    expect(card.phone).toBeNull()
    expect(card.email).toBeNull()
  })

  it('скрытый профиль отвечает как несуществующий — перебор id ничего не подтверждает', async () => {
    const { service } = setup(sourceUser({ careerProfile: { visibility: 'HIDDEN' } }))
    await expect(service.cardForEmployer(employer, 'stu-1', ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('профиль без карьерного блока работодателю не показывается', async () => {
    const { service } = setup(sourceUser({ careerProfile: null }))
    await expect(service.cardForEmployer(employer, 'stu-1', ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('допуск компании к вузу проверяется до выдачи данных', async () => {
    const { service, access } = setup()
    access.assertCanAccessUniversity.mockRejectedValue(
      new AppException('WRONG_SCOPE', 'нет допуска'),
    )
    await expect(service.cardForEmployer(employer, 'stu-1', ctx)).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('каждое открытие карточки попадает в аудит', async () => {
    const { service, audit } = setup()
    await service.cardForEmployer(employer, 'stu-1', ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'career_candidate_viewed', entityId: 'stu-1' }),
    )
  })

  it('подтверждённые вузом сертификаты и самозаявленное портфолио различимы', async () => {
    const { service } = setup()
    const card = await service.cardForEmployer(employer, 'stu-1', ctx)
    expect(card.portfolio.every((p) => p.verified === false)).toBe(true)
    expect(card.verifiedCertificates.every((c) => c.verified === true)).toBe(true)
  })

  it('согласия других компаний на эту не распространяются', async () => {
    const { service, prisma } = setup()
    await service.cardForEmployer(employer, 'stu-1', ctx)
    // Выборка ограничена согласиями «всем» и адресными для этой компании.
    expect(prisma.careerConsent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          revokedAt: null,
          OR: [{ companyId: null }, { companyId: 'co-1' }],
        }),
      }),
    )
  })
})

describe('CareerProfileService — свой профиль', () => {
  it('вилка зарплаты наоборот отклоняется', async () => {
    const { service } = setup()
    await expect(
      service.updateMyProfile(student, { desiredSalaryMin: 500, desiredSalaryMax: 300 }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('смена видимости пишется в аудит отдельным событием', async () => {
    const { service, audit } = setup()
    await service.updateMyProfile(student, { visibility: 'EMPLOYERS' }, ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'career_visibility_changed' }),
    )
  })

  it('отзыв согласия не удаляет запись, а гасит её', async () => {
    const { service, prisma } = setup()
    prisma.careerConsent.findFirst.mockResolvedValue({ id: 'c-1' })

    await service.setConsent(student, { field: 'GPA', granted: false }, ctx)

    expect(prisma.careerConsent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    )
  })

  it('повторная выдача уже активного согласия не плодит записи', async () => {
    const { service, prisma } = setup()
    prisma.careerConsent.findFirst.mockResolvedValue({ id: 'c-1' })

    await service.setConsent(student, { field: 'GPA', granted: true }, ctx)

    expect(prisma.careerConsent.create).not.toHaveBeenCalled()
  })
})

describe('careerReadiness — расчёт готовности', () => {
  it('пустой профиль — ноль', () => {
    expect(
      careerReadiness({
        hasEducation: false,
        skillsCount: 0,
        portfolioCount: 0,
        hasPreferences: false,
        aboutLength: 0,
      }).score,
    ).toBe(0)
  })

  it('полностью заполненный — сто', () => {
    expect(
      careerReadiness({
        hasEducation: true,
        skillsCount: 8,
        portfolioCount: 5,
        hasPreferences: true,
        aboutLength: 300,
      }).score,
    ).toBe(100)
  })

  it('первый навык уже даёт вклад — иначе прогресс не виден', () => {
    const one = careerReadiness({
      hasEducation: false,
      skillsCount: 1,
      portfolioCount: 0,
      hasPreferences: false,
      aboutLength: 0,
    })
    expect(one.score).toBeGreaterThan(0)
  })

  it('сумма частей равна итогу', () => {
    const r = careerReadiness({
      hasEducation: true,
      skillsCount: 3,
      portfolioCount: 2,
      hasPreferences: true,
      aboutLength: 50,
    })
    expect(r.parts.reduce((s, p) => s + p.earned, 0)).toBe(r.score)
  })
})
