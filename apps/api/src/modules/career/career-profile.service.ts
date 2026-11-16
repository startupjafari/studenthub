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
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import {
  PORTFOLIO_ITEM_ORDER,
  portfolioVisibilityWhere,
  type PortfolioAudience,
} from '../portfolio/portfolio.service'
import { CareerAccessService } from './career-access.service'
import { grantProfileToCompany } from './career-profile-grants'

/**
 * Карьерный профиль студента и — главное — ЕДИНСТВЕННОЕ место, где собирается карточка
 * студента для работодателя.
 *
 * Правило, ради которого сервис существует: работодатель никогда не читает `User` напрямую.
 * Любая выдача идёт через `cardForEmployer`, которая применяет четыре фильтра подряд:
 * допуск компании к вузу, видимость карьерного профиля, согласия на чувствительные поля
 * и видимость каждой записи портфолио.
 * Размажь эту логику по контроллерам — и однажды где-то забудут один из них.
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
    const source = await this.loadSource(viewer.sub, 'owner')
    const profile = source.careerProfile

    // Владелец видит готовность по всему своему портфолио, включая приватные записи.
    const readiness = this.readinessOf(source, source.portfolioItems.length)
    // В кэш (его читают другие: отчёт карьерного центра вуза) — без PRIVATE: запись «только
    // для меня» не должна поднимать оценку, которую видит кто-то, кроме владельца.
    const shared = this.readinessOf(
      source,
      source.portfolioItems.filter((item) => item.visibility !== 'PRIVATE').length,
    )

    // Кэш готовности освежаем при чтении своего профиля: это единственный экран, где
    // значение и так пересчитывается, а отчёты потом читают готовое число.
    if (profile && profile.readinessScore !== shared.score) {
      await this.prisma.careerProfile.update({
        where: { userId: viewer.sub },
        data: { readinessScore: shared.score, readinessAt: new Date() },
      })
    }

    const [consents, grants] = await Promise.all([
      this.prisma.careerConsent.findMany({
        where: { userId: viewer.sub, revokedAt: null },
        select: { field: true, companyId: true, grantedAt: true },
        take: 100,
      }),
      // Компании, которым скрытый профиль открыт адресно (21.D1) — чтобы студент видел, кому
      // открыл, и мог закрыть. Компаний, куда человек откликался, единицы — take страхует.
      this.prisma.careerProfileGrant.findMany({
        where: { userId: viewer.sub, revokedAt: null },
        select: { companyId: true, grantedAt: true, company: { select: { name: true } } },
        orderBy: { grantedAt: 'desc' },
        take: 100,
      }),
    ])

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
      profileGrants: grants.map((g) => ({
        companyId: g.companyId,
        companyName: g.company.name,
        grantedAt: g.grantedAt,
      })),
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
   *
   * Уникальности «одно активное согласие» в схеме нет намеренно (история выдач и отзывов),
   * поэтому выдача и отзыв идут под транзакционным локом по (студент, поле, компания): две
   * выдачи из двух вкладок иначе обе видели «активного нет» и заводили две строки. Отзыв
   * гасит ВСЕ активные строки, а не первую найденную, — даже если дубль уже есть в данных,
   * GPA, телефон и почта перестают уходить работодателю сразу.
   */
  async setConsent(viewer: JwtPayload, input: SetCareerConsentInput, ctx: RequestContext) {
    const companyId = input.companyId ?? null
    const where = { userId: viewer.sub, field: input.field, companyId, revokedAt: null }

    await this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `career-consent:${viewer.sub}:${input.field}:${companyId ?? ''}`)
      if (!input.granted) {
        await tx.careerConsent.updateMany({ where, data: { revokedAt: new Date() } })
        return
      }
      const existing = await tx.careerConsent.findFirst({ where, select: { id: true } })
      if (!existing) {
        await tx.careerConsent.create({
          data: { userId: viewer.sub, field: input.field, companyId },
        })
      }
    })

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

  // ── Адресное открытие профиля компании (21.D1) ─────────────────────────────

  /**
   * Открыть скрытый профиль одной компании — повторно, из «Моих откликов» (первый раз это
   * делает галочка в отклике). Открыть можно только компании, куда студент откликался:
   * иначе это был бы способ самому разослать профиль компаниям мимо видимости «для всех».
   */
  async shareWithCompany(viewer: JwtPayload, companyId: string, ctx: RequestContext) {
    const applied = await this.prisma.careerApplication.count({
      where: { studentId: viewer.sub, companyId },
    })
    if (applied === 0) {
      throw new AppException('NOT_FOUND', 'Отклика в эту компанию нет')
    }
    await grantProfileToCompany(this.prisma, viewer.sub, companyId)
    await this.audit.record({
      userId: viewer.sub,
      action: 'career_profile_shared',
      entity: 'CareerProfileGrant',
      entityId: viewer.sub,
      metadata: { companyId, via: 'settings' },
      ...ctx,
    })
  }

  /**
   * Закрыть профиль компании. Действует сразу: карточка проверяет открытие в момент запроса.
   * Идемпотентно — закрытие уже закрытого (или не открывавшегося) не ошибка.
   */
  async unshareWithCompany(viewer: JwtPayload, companyId: string, ctx: RequestContext) {
    const { count } = await this.prisma.careerProfileGrant.updateMany({
      where: { userId: viewer.sub, companyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (count === 0) return
    await this.audit.record({
      userId: viewer.sub,
      action: 'career_profile_unshared',
      entity: 'CareerProfileGrant',
      entityId: viewer.sub,
      metadata: { companyId },
      ...ctx,
    })
  }

  // ── Карточка для работодателя ──────────────────────────────────────────────

  /**
   * Карточка студента глазами работодателя. Четыре барьера подряд, все обязательны:
   *
   * 1. Компания допущена к вузу этого студента (иначе NOT_FOUND, а не WRONG_SCOPE: разный
   *    ответ на «чужой вуз» и «нет такого» подтверждал бы перебором, что id существует).
   * 2. Карьерный профиль открыт для работодателей либо адресно этой компании (21.D1:
   *    галочка в отклике). Иначе NOT_FOUND — существование скрытого профиля не подтверждаем.
   * 3. GPA, телефон и email отдаются только при активном согласии.
   * 4. Из портфолио — только PUBLIC-записи: компания вне вуза, UNIVERSITY ей не положено,
   *    PRIVATE — тем более.
   *
   * Каждое открытие карточки пишется в аудит: это чтение персональных данных студента
   * внешней компанией, и оно должно быть прослеживаемым.
   */
  async cardForEmployer(viewer: JwtPayload, studentId: string, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    const source = await this.loadSource(studentId, 'external')

    if (
      !source.universityId ||
      !(await this.access.canAccessUniversity(companyId, source.universityId))
    ) {
      throw new AppException('NOT_FOUND', 'Профиль не найден')
    }

    // Профиля нет совсем — нечего и открывать: адресное открытие без карьерного блока не
    // делает карточку из пустоты.
    const careerProfile = source.careerProfile
    if (
      !careerProfile ||
      (careerProfile.visibility !== 'EMPLOYERS' &&
        !(await this.hasProfileGrant(studentId, companyId)))
    ) {
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
      about: careerProfile.about,
      university: source.university?.name ?? null,
      specialty: source.specialty,
      course: source.course,
      graduationYear: source.graduationYear,
      skills: source.skills,
      languages: source.languages,
      employmentStatus: careerProfile.employmentStatus,
      desiredPositions: careerProfile.desiredPositions,
      employmentTypes: careerProfile.employmentTypes,
      workFormats: careerProfile.workFormats,
      relocationReady: careerProfile.relocationReady,
      // Готовность — по тому, что работодатель видит сам: портфолио здесь уже только PUBLIC.
      // Кэш в профиле для этого не годится: он считает и записи «для вуза» и устаревает,
      // пока студент не откроет свой профиль.
      readinessScore: this.readinessOf(source, source.portfolioItems.length).score,

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

  /** Оценка готовности по профилю; `portfolioCount` — сколько записей видит тот, кому она. */
  private readinessOf(
    source: {
      specialty: string | null
      course: number | null
      skills: string[]
      careerProfile: { desiredPositions: string[]; about: string | null } | null
    },
    portfolioCount: number,
  ) {
    return careerReadiness({
      hasEducation: Boolean(source.specialty && source.course),
      skillsCount: source.skills.length,
      portfolioCount,
      hasPreferences: (source.careerProfile?.desiredPositions.length ?? 0) > 0,
      aboutLength: source.careerProfile?.about?.length ?? 0,
    })
  }

  /** Студент открыл скрытый профиль этой компании и не закрыл (21.D1). */
  private async hasProfileGrant(userId: string, companyId: string): Promise<boolean> {
    const grant = await this.prisma.careerProfileGrant.findFirst({
      where: { userId, companyId, revokedAt: null },
      select: { id: true },
    })
    return grant !== null
  }

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

  /**
   * Одна выборка на всё: профиль вуза + карьерный блок + портфолио + сертификаты.
   * `audience` решает, какие записи портфолио попадут в выборку (см. portfolioVisibilityWhere).
   */
  private loadSource(userId: string, audience: PortfolioAudience) {
    return this.prisma.user
      .findFirst({
        // Заблокированного студента внешней стороне не показываем — как и его публичное
        // резюме (resume.service): блокировка снимает человека с витрины целиком.
        where: {
          id: userId,
          deletedAt: null,
          ...(audience === 'external' ? { isBlocked: false } : {}),
        },
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
            where: portfolioVisibilityWhere(audience),
            select: {
              id: true,
              kind: true,
              title: true,
              organization: true,
              description: true,
              url: true,
              startDate: true,
              endDate: true,
              // Для оценки готовности без PRIVATE; в карточку работодателя не уходит.
              visibility: true,
            },
            orderBy: PORTFOLIO_ITEM_ORDER,
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
