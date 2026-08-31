import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  canTransitionAccess,
  type CompanyAccessStatus,
  type DecideCompanyAccessInput,
  type EmployerSignupInput,
  type RequestCompanyAccessInput,
  type UpdateCompanyInput,
} from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { PasswordService } from '../../common/security/password.service'
import { AuditService } from '../../common/audit/audit.service'
import { EMAIL_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { webBaseUrl } from '../../config/web-base'
import { CareerAccessService } from './career-access.service'

/** Срок жизни ссылки подтверждения email. Сутки: письмо могут открыть на следующий день. */
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000

export interface RequestContext {
  ip?: string
  userAgent?: string
}

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly access: CareerAccessService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  // ── Регистрация ────────────────────────────────────────────────────────────

  /**
   * Самостоятельная регистрация работодателя.
   *
   * ЕДИНСТВЕННЫЙ публичный эндпоинт платформы, создающий пользователя без инвайта.
   * Правило «никакой регистрации в обход инвайта» защищает от появления посторонних
   * ВНУТРИ вуза — работодатель внутрь вуза не попадает: созданный аккаунт не видит ни
   * одного студента, пока вуз не одобрит заявку (CompanyUniversityAccess). До
   * подтверждения email компания вообще не видна ни одному вузу.
   *
   * Ответ намеренно одинаков и для нового адреса, и для занятого: иначе эндпоинт
   * превращается в проверку «есть ли такой пользователь на платформе».
   */
  async signup(input: EmployerSignupInput, ctx: RequestContext): Promise<{ email: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })
    if (existing) {
      // Молча выходим: подтверждающего письма не будет, а перебор адресов ничего не даёт.
      this.logger.warn('Регистрация работодателя на занятый email — ответ-заглушка')
      return { email: input.email }
    }

    const passwordHash = await this.passwords.hash(input.password)
    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS)

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: input.companyName,
          slug: await this.uniqueSlug(tx, input.companyName),
          website: input.website,
          status: 'PENDING_EMAIL',
          // Токен подтверждения храним хэшем — как refresh-токены, в открытом виде в БД
          // его быть не должно.
          emailVerificationHash: this.hashToken(rawToken),
          emailVerificationExpiresAt: expiresAt,
        },
        select: { id: true, name: true },
      })

      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          role: Role.EMPLOYER,
          // Работодатель вне вуза: скоуп пустой намеренно.
          universityId: null,
          facultyId: null,
          groupId: null,
          // Профиль работодателя не показывается студентам как обычный профиль.
          profileVisibility: 'PRIVATE',
        },
        select: { id: true },
      })

      await tx.company.update({ where: { id: created.id }, data: { createdById: user.id } })
      await tx.companyMember.create({
        data: { companyId: created.id, userId: user.id, role: 'OWNER' },
      })
      return created
    })

    await this.queue.enqueue(
      QUEUES.EMAIL,
      EMAIL_JOBS.SEND_COMPANY_VERIFICATION,
      {
        to: input.email,
        companyName: company.name,
        verifyUrl: `${this.webBase()}/employer/verify?token=${rawToken}`,
        expiresAt: expiresAt.toLocaleString('ru-RU'),
      },
      { jobId: `company-verify:${company.id}` },
    )

    await this.audit.record({
      action: 'company_signup',
      entity: 'Company',
      entityId: company.id,
      ...ctx,
    })

    return { email: input.email }
  }

  /** Подтверждение адреса: компания становится ACTIVE и может подавать заявки в вузы. */
  async verifyEmail(token: string, ctx: RequestContext): Promise<{ companyId: string }> {
    const company = await this.prisma.company.findFirst({
      where: {
        emailVerificationHash: this.hashToken(token),
        status: 'PENDING_EMAIL',
        deletedAt: null,
      },
      select: { id: true, emailVerificationExpiresAt: true },
    })
    if (!company) {
      throw new AppException('NOT_FOUND', 'Ссылка недействительна')
    }
    if (
      company.emailVerificationExpiresAt &&
      company.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new AppException('BAD_REQUEST', 'Срок действия ссылки истёк')
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        status: 'ACTIVE',
        // Токен одноразовый: гасим сразу, повторный переход по ссылке ничего не даст.
        emailVerificationHash: null,
        emailVerificationExpiresAt: null,
      },
    })

    await this.audit.record({
      action: 'company_email_verified',
      entity: 'Company',
      entityId: company.id,
      ...ctx,
    })
    return { companyId: company.id }
  }

  // ── Профиль компании ───────────────────────────────────────────────────────

  async myCompany(viewer: JwtPayload) {
    const companyId = this.access.requireCompany(viewer)
    return this.companyCard(companyId)
  }

  async updateMyCompany(viewer: JwtPayload, input: UpdateCompanyInput, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    await this.assertOwner(viewer, companyId)

    await this.prisma.company.update({ where: { id: companyId }, data: input })
    await this.audit.record({
      userId: viewer.sub,
      action: 'company_updated',
      entity: 'Company',
      entityId: companyId,
      ...ctx,
    })
    return this.companyCard(companyId)
  }

  // ── Заявка на допуск к вузу ────────────────────────────────────────────────

  /**
   * Компания просит вуз открыть доступ к студентам. Запись одна на пару «компания ↔ вуз»:
   * повторное обращение после отказа переводит существующую в REQUESTED, а не плодит
   * новые — иначе история отказов стала бы способом спамить вуз.
   */
  async requestAccess(viewer: JwtPayload, input: RequestCompanyAccessInput, ctx: RequestContext) {
    const companyId = this.access.requireCompany(viewer)
    await this.assertOwner(viewer, companyId)
    await this.assertCompanyActive(companyId)

    const university = await this.prisma.university.findFirst({
      where: { id: input.universityId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!university) {
      throw new AppException('NOT_FOUND', 'Университет не найден')
    }

    const existing = await this.prisma.companyUniversityAccess.findUnique({
      where: { companyId_universityId: { companyId, universityId: input.universityId } },
      select: { id: true, status: true },
    })

    if (existing) {
      const from = existing.status as CompanyAccessStatus
      if (from === 'REQUESTED') {
        throw new AppException('CONFLICT', 'Заявка уже на рассмотрении')
      }
      if (from === 'APPROVED') {
        throw new AppException('CONFLICT', 'Доступ уже открыт')
      }
      if (!canTransitionAccess(from, 'REQUESTED')) {
        throw new AppException('CONFLICT', 'Повторная заявка сейчас невозможна')
      }
      await this.prisma.companyUniversityAccess.update({
        where: { id: existing.id },
        data: {
          status: 'REQUESTED',
          message: input.message,
          requestedById: viewer.sub,
          requestedAt: new Date(),
          decidedById: null,
          decidedAt: null,
          reason: null,
          expiresAt: null,
        },
      })
    } else {
      await this.prisma.companyUniversityAccess.create({
        data: {
          companyId,
          universityId: input.universityId,
          status: 'REQUESTED',
          message: input.message,
          requestedById: viewer.sub,
        },
      })
    }

    await this.audit.record({
      userId: viewer.sub,
      action: 'company_access_requested',
      entity: 'CompanyUniversityAccess',
      entityId: `${companyId}:${input.universityId}`,
      ...ctx,
    })
    return this.myAccessList(viewer)
  }

  /** Заявки и допуски компании — что видит сам работодатель. */
  async myAccessList(viewer: JwtPayload) {
    const companyId = this.access.requireCompany(viewer)
    const rows = await this.prisma.companyUniversityAccess.findMany({
      where: { companyId },
      select: {
        id: true,
        status: true,
        message: true,
        reason: true,
        requestedAt: true,
        decidedAt: true,
        expiresAt: true,
        university: { select: { id: true, name: true, shortName: true, city: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    })
    return rows
  }

  /**
   * Справочник вузов для компании: куда можно подать заявку и что с ней уже происходит.
   *
   * Отдельный эндпоинт, а не общий GET /universities: тот открыт только платформенным
   * ролям и отдаёт служебные поля. Здесь — минимум (название, город) плюс статус
   * собственной заявки, чтобы фронт не склеивал два списка руками.
   */
  async universityDirectory(viewer: JwtPayload, search?: string) {
    const companyId = this.access.requireCompany(viewer)

    const [universities, access] = await Promise.all([
      this.prisma.university.findMany({
        where: {
          status: 'ACTIVE',
          ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        },
        select: { id: true, name: true, shortName: true, city: true },
        orderBy: { name: 'asc' },
        take: 50,
      }),
      this.prisma.companyUniversityAccess.findMany({
        where: { companyId },
        select: { universityId: true, status: true, expiresAt: true, reason: true },
        take: 500,
      }),
    ])

    const byUniversity = new Map(access.map((a) => [a.universityId, a]))
    return universities.map((u) => ({
      ...u,
      access: byUniversity.get(u.id) ?? null,
    }))
  }

  // ── Сторона вуза: очередь заявок и решения ─────────────────────────────────

  /**
   * Заявки компаний в вуз. Скоуп берётся ИЗ ТОКЕНА сотрудника, а не из query:
   * иначе админ одного вуза читал бы очередь другого.
   */
  async universityAccessList(
    viewer: JwtPayload,
    query: { status?: CompanyAccessStatus; page: number; limit: number },
  ) {
    const universityId = this.requireUniversity(viewer)
    const where: Prisma.CompanyUniversityAccessWhereInput = {
      universityId,
      ...(query.status ? { status: query.status } : {}),
      // Компанию с неподтверждённым адресом вуз не видит вовсе.
      company: { status: { not: 'PENDING_EMAIL' }, deletedAt: null },
    }

    const [items, total] = await Promise.all([
      this.prisma.companyUniversityAccess.findMany({
        where,
        select: {
          id: true,
          status: true,
          message: true,
          reason: true,
          requestedAt: true,
          decidedAt: true,
          expiresAt: true,
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              website: true,
              city: true,
              logoUrl: true,
              description: true,
              status: true,
            },
          },
        },
        orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.companyUniversityAccess.count({ where }),
    ])
    return { items, total }
  }

  /** Решение вуза по заявке: одобрить, отказать или отозвать выданный допуск. */
  async decideAccess(
    viewer: JwtPayload,
    accessId: string,
    input: DecideCompanyAccessInput,
    ctx: RequestContext,
  ) {
    const universityId = this.requireUniversity(viewer)
    const record = await this.prisma.companyUniversityAccess.findUnique({
      where: { id: accessId },
      select: { id: true, status: true, companyId: true, universityId: true },
    })
    if (!record) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    // Guard проверяет роль, но принадлежность ресурса обязан проверить сервис (§6.1).
    if (record.universityId !== universityId) {
      throw new AppException('WRONG_SCOPE', 'Заявка другого университета')
    }

    const from = record.status as CompanyAccessStatus
    if (!canTransitionAccess(from, input.status)) {
      throw new AppException('CONFLICT', `Переход ${from} → ${input.status} недопустим`)
    }

    await this.prisma.companyUniversityAccess.update({
      where: { id: record.id },
      data: {
        status: input.status,
        reason: input.reason,
        decidedById: viewer.sub,
        decidedAt: new Date(),
        expiresAt:
          input.status === 'APPROVED' && input.expiresAt ? new Date(input.expiresAt) : null,
      },
    })

    // Кэш допусков обязан сброситься сразу: отзыв, действующий через минуту, — инцидент.
    await this.access.invalidate(record.companyId)

    await this.audit.record({
      userId: viewer.sub,
      action: `company_access_${input.status.toLowerCase()}`,
      entity: 'CompanyUniversityAccess',
      entityId: record.id,
      metadata: { companyId: record.companyId, universityId },
      ...ctx,
    })
  }

  // ── Служебное ──────────────────────────────────────────────────────────────

  private async companyCard(companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        website: true,
        city: true,
        logoUrl: true,
        status: true,
        blockedReason: true,
        createdAt: true,
      },
    })
    if (!company) {
      throw new AppException('NOT_FOUND', 'Компания не найдена')
    }
    return company
  }

  private async assertOwner(viewer: JwtPayload, companyId: string): Promise<void> {
    const member = await this.prisma.companyMember.findUnique({
      where: { userId: viewer.sub },
      select: { companyId: true, role: true },
    })
    if (!member || member.companyId !== companyId) {
      throw new AppException('FORBIDDEN', 'Нет доступа к этой компании')
    }
    if (member.role !== 'OWNER') {
      throw new AppException('FORBIDDEN', 'Действие доступно владельцу компании')
    }
  }

  private async assertCompanyActive(companyId: string): Promise<void> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { status: true, blockedReason: true },
    })
    if (!company) throw new AppException('NOT_FOUND', 'Компания не найдена')
    if (company.status === 'PENDING_EMAIL') {
      throw new AppException('FORBIDDEN', 'Сначала подтвердите email компании')
    }
    if (company.status === 'BLOCKED') {
      throw new AppException('FORBIDDEN', company.blockedReason ?? 'Компания заблокирована')
    }
  }

  private requireUniversity(viewer: JwtPayload): string {
    if (!viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }
    return viewer.universityId
  }

  /** Хэш токена подтверждения — в БД открытый токен не хранится (как refresh). */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /**
   * Slug из названия. Кириллица транслитерации не получает намеренно: slug попадает в URL
   * публичной страницы, и вместо нечитаемой транслитерации берём короткий случайный
   * суффикс — он всё равно нужен для уникальности.
   */
  private async uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'company'

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`
      if (candidate.length < 3) continue
      const taken = await tx.company.findUnique({
        where: { slug: candidate },
        select: { id: true },
      })
      if (!taken) return candidate
    }
    return `company-${randomBytes(6).toString('hex')}`
  }

  private webBase(): string {
    return webBaseUrl(this.config)
  }
}
