import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  matchVacancy,
  type DecideVacancyInput,
  type EmploymentType,
  type UpdateVacancyInput,
  type VacancyInput,
  type VacancyReviewStatus,
  type VacancySearchInput,
  type WorkFormat,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CareerAccessService } from './career-access.service'

/** Карточка вакансии для студента — без служебных полей компании. */
const PUBLIC_SELECT = {
  id: true,
  title: true,
  description: true,
  employmentType: true,
  workFormat: true,
  experienceLevel: true,
  city: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  skills: true,
  languages: true,
  deadline: true,
  publishedAt: true,
  company: { select: { id: true, name: true, slug: true, logoUrl: true, city: true } },
} satisfies Prisma.VacancySelect

@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CareerAccessService,
  ) {}

  // ── Сторона компании ───────────────────────────────────────────────────────

  async listMine(viewer: JwtPayload, page: number, limit: number) {
    const companyId = this.access.requireCompany(viewer)
    const where: Prisma.VacancyWhereInput = { companyId, deletedAt: null }

    const [items, total] = await Promise.all([
      this.prisma.vacancy.findMany({
        where,
        select: {
          ...PUBLIC_SELECT,
          status: true,
          views: true,
          createdAt: true,
          reviews: {
            select: {
              status: true,
              reason: true,
              university: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vacancy.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  async create(viewer: JwtPayload, input: VacancyInput, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    this.assertSalaryRange(input)

    const vacancy = await this.prisma.vacancy.create({
      data: {
        ...input,
        deadline: input.deadline ? new Date(input.deadline) : null,
        companyId,
        createdById: viewer.sub,
        status: 'DRAFT',
      },
      select: { id: true },
    })

    await this.audit.record({
      userId: viewer.sub,
      action: 'vacancy_created',
      entity: 'Vacancy',
      entityId: vacancy.id,
      ...ctx,
    })
    return vacancy
  }

  async update(viewer: JwtPayload, id: string, input: UpdateVacancyInput, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    const existing = await this.ownVacancy(companyId, id)
    this.assertSalaryRange({ ...existing, ...input })

    await this.prisma.vacancy.update({
      where: { id },
      data: {
        ...input,
        ...(input.deadline !== undefined
          ? { deadline: input.deadline ? new Date(input.deadline) : null }
          : {}),
      },
    })

    await this.audit.record({
      userId: viewer.sub,
      action: 'vacancy_updated',
      entity: 'Vacancy',
      entityId: id,
      ...ctx,
    })
  }

  /**
   * Публикация вакансии.
   *
   * Здесь же создаются строки ревью — по одной на каждый вуз с активным допуском. Один
   * общий статус «на модерации» не годится: компания допущена в несколько вузов, и
   * одобрение одним из них не должно открывать вакансию студентам другого. Вузов у
   * компании единицы, поэтому строк немного.
   *
   * Повторная публикация после правок сбрасывает решения обратно в PENDING: вуз одобрял
   * конкретный текст, а не саму вакансию навсегда.
   */
  async publish(viewer: JwtPayload, id: string, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    await this.ownVacancy(companyId, id)

    const universities = await this.access.allowedUniversityIds(companyId)
    if (universities.length === 0) {
      throw new AppException(
        'FORBIDDEN',
        'Нет ни одного университета с открытым доступом — вакансию некому показать',
      )
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vacancy.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      })
      for (const universityId of universities) {
        await tx.vacancyUniversityReview.upsert({
          where: { vacancyId_universityId: { vacancyId: id, universityId } },
          create: { vacancyId: id, universityId, status: 'PENDING' },
          update: { status: 'PENDING', reason: null, decidedById: null, decidedAt: null },
        })
      }
    })

    await this.audit.record({
      userId: viewer.sub,
      action: 'vacancy_published',
      entity: 'Vacancy',
      entityId: id,
      metadata: { universities: universities.length },
      ...ctx,
    })
  }

  /** Снять с публикации или закрыть. Ревью не трогаем: они пригодятся при повторной публикации. */
  async setStatus(
    viewer: JwtPayload,
    id: string,
    status: 'PAUSED' | 'CLOSED',
    ctx: RequestContext,
  ) {
    const companyId = this.access.requireCompany(viewer)
    await this.ownVacancy(companyId, id)

    await this.prisma.vacancy.update({ where: { id }, data: { status } })
    await this.audit.record({
      userId: viewer.sub,
      action: `vacancy_${status.toLowerCase()}`,
      entity: 'Vacancy',
      entityId: id,
      ...ctx,
    })
  }

  // ── Витрина для студента ───────────────────────────────────────────────────

  /**
   * Вакансии, доступные студенту: опубликованные компаниями, которые допущены в ЕГО вуз,
   * и одобренные этим вузом. Скоуп берётся из токена — вуз в запросе не передаётся.
   */
  async search(viewer: JwtPayload, query: VacancySearchInput) {
    const universityId = viewer.universityId
    if (!universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }

    const where: Prisma.VacancyWhereInput = {
      deletedAt: null,
      status: 'PUBLISHED',
      // Ключевое условие видимости: вакансия одобрена вузом этого студента.
      reviews: { some: { universityId, status: 'APPROVED' } },
      ...(query.employmentType ? { employmentType: query.employmentType } : {}),
      ...(query.workFormat ? { workFormat: query.workFormat } : {}),
      ...(query.experienceLevel ? { experienceLevel: query.experienceLevel } : {}),
      ...(query.city ? { city: query.city } : {}),
      ...(query.salaryFrom ? { salaryMax: { gte: query.salaryFrom } } : {}),
      ...(query.skills?.length ? { skills: { hasSome: query.skills } } : {}),
      // Два независимых условия-ИЛИ собираем через AND: если оба положить ключом `OR`
      // в один объект, второй молча затрёт первый и фильтр по тексту пропадёт.
      AND: [
        // Просроченные не показываем: отклик на них всё равно не примут.
        { OR: [{ deadline: null }, { deadline: { gte: new Date() } }] },
        ...(query.search
          ? [
              {
                OR: [
                  { title: { contains: query.search, mode: 'insensitive' as const } },
                  { description: { contains: query.search, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    }

    const [items, total, profile] = await Promise.all([
      this.prisma.vacancy.findMany({
        where,
        select: PUBLIC_SELECT,
        orderBy: this.orderBy(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.vacancy.count({ where }),
      this.matchProfile(viewer.sub),
    ])

    // Совпадение считаем на выдаче: оно зависит от профиля, кэшировать в вакансии нечего.
    const withMatch = items.map((vacancy) => ({
      ...vacancy,
      match: profile
        ? matchVacancy({
            vacancy: {
              skills: vacancy.skills,
              employmentType: vacancy.employmentType as EmploymentType,
              workFormat: vacancy.workFormat as WorkFormat,
              city: vacancy.city,
            },
            profile,
          })
        : null,
    }))

    return new Paginated(withMatch, { total })
  }

  /** Одна вакансия студенту — с той же проверкой видимости, что и в списке. */
  async byIdForStudent(viewer: JwtPayload, id: string) {
    const universityId = viewer.universityId
    if (!universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: {
        id,
        deletedAt: null,
        status: 'PUBLISHED',
        reviews: { some: { universityId, status: 'APPROVED' } },
      },
      select: { ...PUBLIC_SELECT, company: { select: PUBLIC_SELECT.company.select } },
    })
    if (!vacancy) throw new AppException('NOT_FOUND', 'Вакансия не найдена')

    // Счётчик просмотров — не в транзакции и без ожидания консистентности: это метрика.
    await this.prisma.vacancy.update({ where: { id }, data: { views: { increment: 1 } } })
    return vacancy
  }

  // ── Сторона вуза: модерация ────────────────────────────────────────────────

  async reviewQueue(
    viewer: JwtPayload,
    status: VacancyReviewStatus | undefined,
    page: number,
    limit: number,
  ) {
    const universityId = this.requireUniversity(viewer)
    const where: Prisma.VacancyUniversityReviewWhereInput = {
      universityId,
      ...(status ? { status } : {}),
      vacancy: { deletedAt: null, status: 'PUBLISHED' },
    }

    const [items, total] = await Promise.all([
      this.prisma.vacancyUniversityReview.findMany({
        where,
        select: {
          id: true,
          status: true,
          reason: true,
          createdAt: true,
          decidedAt: true,
          vacancy: { select: PUBLIC_SELECT },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vacancyUniversityReview.count({ where }),
    ])
    return new Paginated(items, { total })
  }

  async decide(
    viewer: JwtPayload,
    reviewId: string,
    input: DecideVacancyInput,
    ctx: RequestContext,
  ) {
    const universityId = this.requireUniversity(viewer)
    const review = await this.prisma.vacancyUniversityReview.findUnique({
      where: { id: reviewId },
      select: { id: true, universityId: true, vacancyId: true },
    })
    if (!review) throw new AppException('NOT_FOUND', 'Заявка не найдена')
    if (review.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Вакансия рассматривается другим университетом')
    }

    await this.prisma.vacancyUniversityReview.update({
      where: { id: reviewId },
      data: {
        status: input.status,
        reason: input.reason,
        decidedById: viewer.sub,
        decidedAt: new Date(),
      },
    })

    await this.audit.record({
      userId: viewer.sub,
      action: `vacancy_review_${input.status.toLowerCase()}`,
      entity: 'Vacancy',
      entityId: review.vacancyId,
      metadata: { universityId },
      ...ctx,
    })
  }

  // ── Служебное ──────────────────────────────────────────────────────────────

  /** Карьерный профиль для расчёта совпадения. Нет профиля — совпадение не считаем. */
  private async matchProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { skills: true, country: true, careerProfile: true },
    })
    if (!user?.careerProfile) return null
    return {
      skills: user.skills,
      employmentTypes: user.careerProfile.employmentTypes as EmploymentType[],
      workFormats: user.careerProfile.workFormats as WorkFormat[],
      city: user.country,
      relocationReady: user.careerProfile.relocationReady,
    }
  }

  private orderBy(query: VacancySearchInput): Prisma.VacancyOrderByWithRelationInput[] {
    switch (query.sort) {
      case 'salary':
        // Сначала более высокая верхняя граница; вакансии без зарплаты уходят вниз.
        return [{ salaryMax: { sort: query.order, nulls: 'last' } }, { publishedAt: 'desc' }]
      case 'deadline':
        return [{ deadline: { sort: query.order, nulls: 'last' } }, { publishedAt: 'desc' }]
      default:
        return [{ publishedAt: query.order }]
    }
  }

  private async ownVacancy(companyId: string, id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, salaryMin: true, salaryMax: true },
    })
    if (!vacancy) throw new AppException('NOT_FOUND', 'Вакансия не найдена')
    return vacancy
  }

  private requireUniversity(viewer: JwtPayload): string {
    if (viewer.role === Role.PLATFORM_ADMIN && !viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Выберите университет')
    }
    if (!viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }
    return viewer.universityId
  }

  private assertSalaryRange(input: { salaryMin?: number | null; salaryMax?: number | null }): void {
    const { salaryMin: min, salaryMax: max } = input
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new AppException('BAD_REQUEST', 'Минимальная зарплата больше максимальной')
    }
  }
}
