import { Injectable } from '@nestjs/common'
import {
  careerReadiness,
  type ConsentField,
  type SetCareerConsentInput,
  type UpdateCareerProfileInput,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CareerAccessService } from './career-access.service'

/**
 * Карьерный профиль студента и — главное — ЕДИНСТВЕННОЕ место, где собирается карточка
 * студента для работодателя.
 *
 * Правило, ради которого сервис существует: работодатель никогда не читает `User` напрямую.
 * Любая выдача идёт через `cardForEmployer`, которая применяет три фильтра подряд:
 * допуск компании к вузу, видимость карьерного профиля и согласия на чувствительные поля.
 * Размажь эту логику по контроллерам — и однажды где-то забудут один из трёх.
 */
@Injectable()
export class CareerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: CareerAccessService,
  ) {}

  // ── Свой профиль ───────────────────────────────────────────────────────────

  /** Карьерный профиль владельца — со всеми полями и с разбором готовности. */
  async myProfile(viewer: JwtPayload) {
    const source = await this.loadSource(viewer.sub)
    const profile = source.careerProfile

    const readiness = careerReadiness({
      hasEducation: Boolean(source.specialty && source.course),
      skillsCount: source.skills.length,
      portfolioCount: source.portfolioItems.length,
      hasPreferences: (profile?.desiredPositions.length ?? 0) > 0,
      aboutLength: profile?.about?.length ?? 0,
    })

    // Кэш готовности освежаем при чтении своего профиля: это единственный экран, где
    // значение и так пересчитывается, а списки кандидатов потом читают готовое число.
    if (profile && profile.readinessScore !== readiness.score) {
      await this.prisma.careerProfile.update({
        where: { userId: viewer.sub },
        data: { readinessScore: readiness.score, readinessAt: new Date() },
      })
    }

    const consents = await this.prisma.careerConsent.findMany({
      where: { userId: viewer.sub, revokedAt: null },
      select: { field: true, companyId: true, grantedAt: true },
      take: 100,
    })

    return {
      visibility: profile?.visibility ?? 'HIDDEN',
      employmentStatus: profile?.employmentStatus ?? 'NOT_LOOKING',
      desiredPositions: profile?.desiredPositions ?? [],
      employmentTypes: profile?.employmentTypes ?? [],
      workFormats: profile?.workFormats ?? [],
      relocationReady: profile?.relocationReady ?? false,
      desiredSalaryMin: profile?.desiredSalaryMin ?? null,
      desiredSalaryMax: profile?.desiredSalaryMax ?? null,
      salaryCurrency: profile?.salaryCurrency ?? null,
      about: profile?.about ?? null,
      readiness,
      consents,
      // Из платформы, только для показа: редактируются в обычном профиле.
      inherited: {
        firstName: source.firstName,
        lastName: source.lastName,
        headline: source.headline,
        city: source.country,
        specialty: source.specialty,
        course: source.course,
        graduationYear: source.graduationYear,
        skills: source.skills,
        languages: source.languages,
        universityName: source.university?.name ?? null,
        portfolioCount: source.portfolioItems.length,
      },
    }
  }

  async updateMyProfile(viewer: JwtPayload, input: UpdateCareerProfileInput, ctx: RequestContext) {
    this.assertSalaryRange(input)

    await this.prisma.careerProfile.upsert({
      where: { userId: viewer.sub },
      create: { userId: viewer.sub, ...input },
      update: input,
    })

    // Смена видимости — событие приватности, его нужно видеть в журнале отдельно.
    if (input.visibility) {
      await this.audit.record({
        userId: viewer.sub,
        action: 'career_visibility_changed',
        entity: 'CareerProfile',
        entityId: viewer.sub,
        metadata: { visibility: input.visibility },
        ...ctx,
      })
    }
    return this.myProfile(viewer)
  }

  /**
   * Выдать или отозвать согласие на чувствительное поле.
   * Отзыв не удаляет запись, а проставляет revokedAt: журнал согласий должен остаться.
   */
  async setConsent(viewer: JwtPayload, input: SetCareerConsentInput, ctx: RequestContext) {
    const where = {
      userId: viewer.sub,
      field: input.field,
      companyId: input.companyId ?? null,
      revokedAt: null,
    }
    const existing = await this.prisma.careerConsent.findFirst({ where, select: { id: true } })

    if (input.granted && !existing) {
      await this.prisma.careerConsent.create({
        data: { userId: viewer.sub, field: input.field, companyId: input.companyId ?? null },
      })
    } else if (!input.granted && existing) {
      await this.prisma.careerConsent.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      })
    }

    await this.audit.record({
      userId: viewer.sub,
      action: input.granted ? 'career_consent_granted' : 'career_consent_revoked',
      entity: 'CareerConsent',
      entityId: viewer.sub,
      metadata: { field: input.field, companyId: input.companyId ?? null },
      ...ctx,
    })
    return this.myProfile(viewer)
  }

  // ── Карточка для работодателя ──────────────────────────────────────────────

  /**
   * Карточка студента глазами работодателя. Три барьера подряд, все обязательны:
   *
   * 1. Компания допущена к вузу этого студента (иначе WRONG_SCOPE).
   * 2. Карьерный профиль открыт для работодателей (иначе NOT_FOUND — существование
   *    скрытого профиля не подтверждаем).
   * 3. GPA, телефон и email отдаются только при активном согласии.
   *
   * Каждое открытие карточки пишется в аудит: это чтение персональных данных студента
   * внешней компанией, и оно должно быть прослеживаемым.
   */
  async cardForEmployer(viewer: JwtPayload, studentId: string, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    const source = await this.loadSource(studentId)

    if (!source.universityId) {
      throw new AppException('NOT_FOUND', 'Профиль не найден')
    }
    await this.access.assertCanAccessUniversity(viewer, source.universityId)

    if (source.careerProfile?.visibility !== 'EMPLOYERS') {
      // Скрытый профиль отвечает так же, как несуществующий: иначе перебор id
      // подтверждал бы, что такой студент есть.
      throw new AppException('NOT_FOUND', 'Профиль не найден')
    }

    const allowed = await this.allowedFields(studentId, companyId)

    await this.audit.record({
      userId: viewer.sub,
      action: 'career_candidate_viewed',
      entity: 'User',
      entityId: studentId,
      metadata: { companyId },
      ...ctx,
    })

    return {
      id: source.id,
      firstName: source.firstName,
      lastName: source.lastName,
      avatarUrl: source.avatarThumbUrl ?? source.avatarUrl,
      headline: source.headline,
      about: source.careerProfile.about,
      university: source.university?.name ?? null,
      specialty: source.specialty,
      course: source.course,
      graduationYear: source.graduationYear,
      skills: source.skills,
      languages: source.languages,
      employmentStatus: source.careerProfile.employmentStatus,
      desiredPositions: source.careerProfile.desiredPositions,
      employmentTypes: source.careerProfile.employmentTypes,
      workFormats: source.careerProfile.workFormats,
      relocationReady: source.careerProfile.relocationReady,
      readinessScore: source.careerProfile.readinessScore,

      // Портфолио: самозаявленное студентом. Подтверждённые вузом сертификаты приходят
      // ниже отдельным списком с флагом — разница между ними и есть ценность платформы.
      portfolio: source.portfolioItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        organization: item.organization,
        description: item.description,
        url: item.url,
        startDate: item.startDate,
        endDate: item.endDate,
        verified: false,
      })),
      verifiedCertificates: source.documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        issuedBy: doc.issuedBy,
        issuedAt: doc.issuedAt,
        verified: true,
      })),

      // Чувствительное — только по согласию. `null` означает «не показано», а не «пусто»:
      // различать это в UI важнее, чем экономить поле.
      gpa: allowed.has('GPA') ? source.gpa : null,
      phone: allowed.has('PHONE') ? source.phone : null,
      email: allowed.has('EMAIL') ? source.email : null,
    }
  }

  // ── Служебное ──────────────────────────────────────────────────────────────

  /**
   * Активные согласия студента, применимые к этой компании: выданные всем работодателям
   * плюс адресные для неё.
   */
  private async allowedFields(userId: string, companyId: string): Promise<Set<ConsentField>> {
    const rows = await this.prisma.careerConsent.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ companyId: null }, { companyId }],
      },
      select: { field: true },
      take: 100,
    })
    return new Set(rows.map((r) => r.field as ConsentField))
  }

  /** Одна выборка на всё: профиль вуза + карьерный блок + портфолио + сертификаты. */
  private loadSource(userId: string) {
    return this.prisma.user
      .findFirst({
        where: { id: userId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          gpa: true,
          headline: true,
          country: true,
          specialty: true,
          course: true,
          graduationYear: true,
          skills: true,
          languages: true,
          avatarUrl: true,
          avatarThumbUrl: true,
          universityId: true,
          university: { select: { name: true } },
          careerProfile: true,
          portfolioItems: {
            select: {
              id: true,
              kind: true,
              title: true,
              organization: true,
              description: true,
              url: true,
              startDate: true,
              endDate: true,
            },
            orderBy: { order: 'asc' },
            take: 50,
          },
          // Только подтверждённые вузом сертификаты: самозаявленные лежат в портфолио.
          documents: {
            where: { category: 'CERTIFICATE', status: 'VERIFIED', deletedAt: null },
            select: { id: true, title: true, issuedBy: true, issuedAt: true },
            take: 50,
          },
        },
      })
      .then((user) => {
        if (!user) throw new AppException('NOT_FOUND', 'Профиль не найден')
        return user
      })
  }

  /** Вилка зарплаты «от 500 000 до 300 000» — почти всегда опечатка, а не намерение. */
  private assertSalaryRange(input: UpdateCareerProfileInput): void {
    const { desiredSalaryMin: min, desiredSalaryMax: max } = input
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new AppException('BAD_REQUEST', 'Минимальная зарплата больше максимальной')
    }
  }
}
