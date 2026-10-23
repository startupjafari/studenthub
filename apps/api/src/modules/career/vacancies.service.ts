import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  canTransitionVacancy,
  canTransitionVacancyReview,
  matchVacancy,
  type DecideVacancyInput,
  type EmploymentType,
  type UpdateVacancyInput,
  type VacancyInput,
  type VacancyReviewStatus,
  type VacancySearchInput,
  type VacancyStatus,
  type WorkFormat,
  VACANCY_REVIEWED_FIELDS,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { CAREER_STUDENT_ROLES, resolveUniversityScope } from './career-scope'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import {
  ACTIVE_COMPANY_WHERE,
  activeAccessWhere,
  CareerAccessService,
  vacancyVisibleWhere,
} from './career-access.service'
import { CareerNotifier } from './career-notifier'
import { rethrowStaleStatus } from '../../common/prisma/stale-status'

/**
 * Поля, которые читает студент и одобрял вуз (общий список с формой компании — shared-schemas).
 * Правка любого из них возвращает вакансию на модерацию: вуз пропускал конкретный текст и
 * условия, а не вакансию навсегда, и без этого одобренную безобидную вакансию можно было бы
 * переписать во что угодно мимо модерации.
 *
 * Срок приёма откликов (`deadline`) сюда не входит: продление или сокращение срока не
 * меняет прочитанного вузом, а витрина и отклик сверяются с ним сами.
 */
const REVIEWED_FIELDS = VACANCY_REVIEWED_FIELDS

const REVIEWED_SELECT = Object.fromEntries(REVIEWED_FIELDS.map((f) => [f, true])) as Record<
  (typeof REVIEWED_FIELDS)[number],
  true
>

/** Значение поля изменилось. Массивы — поэлементно: форма присылает их целиком. */
function changed(next: unknown, prev: unknown): boolean {
  if (next === undefined) return false
  if (Array.isArray(next) && Array.isArray(prev)) {
    return next.length !== prev.length || next.some((v, i) => v !== prev[i])
  }
  return (next ?? null) !== (prev ?? null)
}

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
    private readonly notifier: CareerNotifier,
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
    await this.access.assertCompanyActive(companyId)
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

  /**
   * Правка вакансии. Если меняется что-то из прочитанного вузом (REVIEWED_FIELDS), её
   * одобрения тем же шагом возвращаются в PENDING — вакансия уходит с витрины и снова
   * встаёт в очередь модерации. Как в `publish`, но гасим только APPROVED: отклонённую
   * вакансию правка в очередь не возвращает (для этого есть повторная публикация), а
   * ожидающая и так покажет модератору новый текст.
   *
   * Закрытая вакансия — конечное состояние (VACANCY_TRANSITIONS): её не правят, иначе
   * правка возвращала бы в очередь модерации то, что компания уже закрыла.
   */
  async update(viewer: JwtPayload, id: string, input: UpdateVacancyInput, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    await this.access.assertCompanyActive(companyId)
    const existing = await this.prisma.vacancy.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { ...REVIEWED_SELECT, status: true },
    })
    if (!existing) throw new AppException('NOT_FOUND', 'Вакансия не найдена')
    if (existing.status === 'CLOSED') {
      throw new AppException('CONFLICT', 'Закрытую вакансию изменить нельзя')
    }
    this.assertSalaryRange({ ...existing, ...input })

    const reReview = REVIEWED_FIELDS.some((field) => changed(input[field], existing[field]))

    const reset = await this.prisma.$transaction(async (tx) => {
      // Условие на «не закрыта» — и в самой записи: параллельное закрытие между чтением и
      // правкой не должно вернуть закрытую вакансию на модерацию.
      await tx.vacancy
        .update({
          where: { id, status: { not: 'CLOSED' } },
          data: {
            ...input,
            ...(input.deadline !== undefined
              ? { deadline: input.deadline ? new Date(input.deadline) : null }
              : {}),
          },
        })
        .catch(rethrowStaleStatus)
      if (!reReview) return 0
      const { count } = await tx.vacancyUniversityReview.updateMany({
        where: { vacancyId: id, status: 'APPROVED' },
        data: { status: 'PENDING', reason: null, decidedById: null, decidedAt: null },
      })
      return count
    })

    await this.audit.record({
      userId: viewer.sub,
      action: 'vacancy_updated',
      entity: 'Vacancy',
      entityId: id,
      ...(reset > 0 ? { metadata: { reReview: reset } } : {}),
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
   * Повторная публикация (в том числе уже опубликованной) — это «покажите её вузам, где
   * её ещё нет»: вуз, допустивший компанию после первой публикации, получает свою строку
   * ревью, а отклонённое решение (в том числе погашенное отзывом допуска) возвращается на
   * модерацию. Одобрения других вузов не трогаем: вуз одобрял конкретный текст, и правка
   * текста сама возвращает их в PENDING (см. `update`), а повторное нажатие «Опубликовать»
   * без правок не должно снимать вакансию с витрин, где её уже пропустили.
   */
  async publish(viewer: JwtPayload, id: string, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    await this.access.assertCompanyActive(companyId)
    const vacancy = await this.ownVacancy(companyId, id)
    const from = this.assertTransition(vacancy.status, 'PUBLISHED')

    const universities = await this.access.allowedUniversityIds(companyId)
    if (universities.length === 0) {
      throw new AppException(
        'FORBIDDEN',
        'Нет ни одного университета с открытым доступом — вакансию некому показать',
      )
    }

    await this.prisma.$transaction(async (tx) => {
      // Условие на прочитанный статус — в самой записи: параллельное закрытие не должно
      // превратиться в публикацию закрытой вакансии.
      const { count } = await tx.vacancy.updateMany({
        where: { id, status: from, deletedAt: null },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      })
      if (count === 0) throw this.changedConflict()
      await tx.vacancyUniversityReview.createMany({
        data: universities.map((universityId) => ({
          vacancyId: id,
          universityId,
          status: 'PENDING',
        })),
        skipDuplicates: true,
      })
      await tx.vacancyUniversityReview.updateMany({
        where: { vacancyId: id, universityId: { in: universities }, status: 'REJECTED' },
        data: { status: 'PENDING', reason: null, decidedById: null, decidedAt: null },
      })
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
    const vacancy = await this.ownVacancy(companyId, id)
    const from = this.assertTransition(vacancy.status, status)

    const { count } = await this.prisma.vacancy.updateMany({
      where: { id, status: from, deletedAt: null },
      data: { status },
    })
    if (count === 0) throw this.changedConflict()
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
   * и одобренные этим вузом. Скоуп берётся из токена; платформенная роль своего вуза не
   * имеет и указывает его параметром — иначе витрину ей просто не из чего собрать.
   */
  async search(viewer: JwtPayload, query: VacancySearchInput) {
    const universityId = resolveUniversityScope(viewer, query.universityId)

    const where: Prisma.VacancyWhereInput = {
      // Ключевое условие видимости: вакансия одобрена вузом этого студента, и допуск
      // компании в этот вуз действует прямо сейчас.
      ...vacancyVisibleWhere(universityId),
      ...(query.employmentType ? { employmentType: query.employmentType } : {}),
      ...(query.workFormat ? { workFormat: query.workFormat } : {}),
      ...(query.experienceLevel ? { experienceLevel: query.experienceLevel } : {}),
      ...(query.city ? { city: query.city } : {}),
      ...(query.skills?.length ? { skills: { hasSome: query.skills } } : {}),
      // Два независимых условия-ИЛИ собираем через AND: если оба положить ключом `OR`
      // в один объект, второй молча затрёт первый и фильтр по тексту пропадёт.
      AND: [
        // Просроченные не показываем: отклик на них всё равно не примут.
        { OR: [{ deadline: null }, { deadline: { gte: new Date() } }] },
        // «Зарплата от N»: вилка достаёт до N. У вакансии «от M» без верхней границы
        // потолка нет — по ней судим о нижней границе, иначе такие вакансии выпадали всегда.
        ...(query.salaryFrom
          ? [
              {
                OR: [
                  { salaryMax: { gte: query.salaryFrom } },
                  { salaryMax: null, salaryMin: { gte: query.salaryFrom } },
                ],
              },
            ]
          : []),
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
  async byIdForStudent(viewer: JwtPayload, id: string, universityIdParam?: string) {
    const universityId = resolveUniversityScope(viewer, universityIdParam)

    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, ...vacancyVisibleWhere(universityId) },
      select: { ...PUBLIC_SELECT, company: { select: PUBLIC_SELECT.company.select } },
    })
    if (!vacancy) throw new AppException('NOT_FOUND', 'Вакансия не найдена')

    // Счётчик просмотров — не в транзакции и без ожидания консистентности: это метрика.
    // Считаем только студентов: просмотры — знаменатель «отклик на просмотр» в метриках
    // компании, а модератор, декан или платформа откликнуться не могут и лишь занижали бы его.
    if (CAREER_STUDENT_ROLES.includes(viewer.role)) {
      await this.prisma.vacancy.update({ where: { id }, data: { views: { increment: 1 } } })
    }
    return vacancy
  }

  // ── Сторона вуза: модерация ────────────────────────────────────────────────

  async reviewQueue(
    viewer: JwtPayload,
    status: VacancyReviewStatus | undefined,
    page: number,
    limit: number,
    universityIdParam?: string,
  ) {
    const universityId = resolveUniversityScope(viewer, universityIdParam)
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
    universityIdParam?: string,
  ) {
    const universityId = resolveUniversityScope(viewer, universityIdParam)
    const review = await this.prisma.vacancyUniversityReview.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        universityId: true,
        vacancyId: true,
        status: true,
        vacancy: { select: { title: true, companyId: true } },
      },
    })
    if (!review) throw new AppException('NOT_FOUND', 'Заявка не найдена')
    if (review.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Вакансия рассматривается другим университетом')
    }

    // Решение — только по графу (D-F29): погашенное отзывом допуска одобрение вуз обратно
    // не включает, на модерацию вакансию возвращает повторная публикация компанией.
    const from = review.status as VacancyReviewStatus
    if (!canTransitionVacancyReview(from, input.status)) {
      throw new AppException('CONFLICT', `Решение ${from} → ${input.status} недопустимо`)
    }
    // Одобрить можно только опубликованную вакансию компании с действующим допуском в этот
    // вуз. Условие — в самой записи вместе с ожидаемым статусом: параллельное решение
    // другого модератора или отзыв допуска между чтением и записью дают 409, а не
    // «последнее слово за тем, кто записал позже».
    const decidedAt = new Date()
    const { count } = await this.prisma.vacancyUniversityReview.updateMany({
      where: {
        id: reviewId,
        status: from,
        ...(input.status === 'APPROVED'
          ? {
              vacancy: {
                deletedAt: null,
                status: 'PUBLISHED',
                company: {
                  ...ACTIVE_COMPANY_WHERE,
                  universityAccess: { some: activeAccessWhere(universityId) },
                },
              },
            }
          : {}),
      },
      data: {
        status: input.status,
        reason: input.reason,
        decidedById: viewer.sub,
        decidedAt,
      },
    })
    if (count === 0) {
      throw new AppException(
        'CONFLICT',
        input.status === 'APPROVED'
          ? 'Решение уже изменилось, вакансия снята или допуск компании не действует'
          : 'Решение уже изменилось — обновите страницу',
      )
    }

    await this.audit.record({
      userId: viewer.sub,
      action: `vacancy_review_${input.status.toLowerCase()}`,
      entity: 'Vacancy',
      entityId: review.vacancyId,
      metadata: { universityId },
      ...ctx,
    })
    // Компания узнаёт о решении вуза сразу, а не заглянув в кабинет (D-F28).
    await this.notifier.vacancyDecided({
      reviewId: review.id,
      companyId: review.vacancy.companyId,
      vacancyTitle: review.vacancy.title,
      universityId,
      status: input.status,
      reason: input.reason,
      decidedAt,
    })
  }

  // ── Служебное ──────────────────────────────────────────────────────────────

  /** Карьерный профиль для расчёта совпадения. Нет профиля — совпадение не считаем. */
  private async matchProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { skills: true, careerProfile: true },
    })
    if (!user?.careerProfile) return null
    return {
      skills: user.skills,
      employmentTypes: user.careerProfile.employmentTypes as EmploymentType[],
      workFormats: user.careerProfile.workFormats as WorkFormat[],
      // Города студента в модели нет. Раньше сюда шла страна (`User.country`), и «Алматы»
      // вакансии не совпадало с «Казахстан» никогда — каждая очная вакансия теряла 15 баллов.
      // Неизвестный город — не ограничение (matchVacancy), а не повод занижать процент.
      city: null,
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
      select: { id: true, status: true, salaryMin: true, salaryMax: true },
    })
    if (!vacancy) throw new AppException('NOT_FOUND', 'Вакансия не найдена')
    return vacancy
  }

  /** Переход статуса вакансии по графу (shared-schemas); недопустимый — 409 (D-F29). */
  private assertTransition(current: string, to: VacancyStatus): VacancyStatus {
    const from = current as VacancyStatus
    if (!canTransitionVacancy(from, to)) {
      throw new AppException('CONFLICT', `Переход ${from} → ${to} недопустим`)
    }
    return from
  }

  private changedConflict(): AppException {
    return new AppException('CONFLICT', 'Статус вакансии уже изменился — обновите страницу')
  }

  private assertSalaryRange(input: { salaryMin?: number | null; salaryMax?: number | null }): void {
    const { salaryMin: min, salaryMax: max } = input
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new AppException('BAD_REQUEST', 'Минимальная зарплата больше максимальной')
    }
  }
}
