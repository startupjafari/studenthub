import { Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { UpdateResumeInput } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { renderResumePdf, type ResumeData, type ResumeItem, type ResumeLabels } from './resume-pdf'

/**
 * Резюме студента.
 *
 * Содержимое НЕ хранится: оно собирается из карьерного профиля и портфолио при каждой
 * выдаче. Снимок данных тихо устаревал бы, и «обновить резюме» превращалось бы в
 * отдельное действие, о котором забывают.
 */
@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async mine(viewer: JwtPayload) {
    const resume = await this.prisma.resume.findUnique({ where: { userId: viewer.sub } })
    return {
      title: resume?.title ?? 'Резюме',
      published: Boolean(resume?.publicSlug),
      publicSlug: resume?.publicSlug ?? null,
      includeContacts: resume?.includeContacts ?? false,
      updatedAt: resume?.updatedAt ?? null,
    }
  }

  /**
   * Настройки резюме. Выключение публикации СТИРАЕТ slug: студент, закрывший ссылку,
   * ожидает, что она перестала работать, а не что её можно восстановить.
   */
  async update(viewer: JwtPayload, input: UpdateResumeInput, ctx: RequestContext) {
    const current = await this.prisma.resume.findUnique({
      where: { userId: viewer.sub },
      select: { publicSlug: true },
    })

    const slug =
      input.published === undefined
        ? undefined
        : input.published
          ? (current?.publicSlug ?? randomBytes(9).toString('base64url'))
          : null

    await this.prisma.resume.upsert({
      where: { userId: viewer.sub },
      create: {
        userId: viewer.sub,
        title: input.title ?? 'Резюме',
        includeContacts: input.includeContacts ?? false,
        publicSlug: slug ?? null,
        publishedAt: slug ? new Date() : null,
      },
      update: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.includeContacts !== undefined ? { includeContacts: input.includeContacts } : {}),
        ...(slug !== undefined ? { publicSlug: slug, publishedAt: slug ? new Date() : null } : {}),
      },
    })

    if (input.published !== undefined) {
      await this.audit.record({
        userId: viewer.sub,
        action: input.published ? 'resume_published' : 'resume_unpublished',
        entity: 'Resume',
        entityId: viewer.sub,
        ...ctx,
      })
    }
    return this.mine(viewer)
  }

  /** PDF своего резюме. */
  async pdf(viewer: JwtPayload, labels: ResumeLabels): Promise<Buffer> {
    const data = await this.assemble(viewer.sub, { withContacts: true, labels })
    return renderResumePdf(data)
  }

  /**
   * Публичное резюме по ссылке.
   *
   * Отдаёт ровно то, что студент опубликовал: контакты — только если он их включил.
   * Ссылку могут переслать куда угодно, поэтому email по умолчанию наружу не уходит.
   */
  async publicBySlug(slug: string) {
    const resume = await this.prisma.resume.findFirst({
      where: { publicSlug: slug },
      select: { userId: true, title: true, includeContacts: true, updatedAt: true },
    })
    if (!resume) throw new AppException('NOT_FOUND', 'Резюме не найдено')

    const data = await this.assemble(resume.userId, {
      withContacts: resume.includeContacts,
      labels: null,
    })
    return { title: resume.title, updatedAt: resume.updatedAt, ...data }
  }

  // ── Сборка ─────────────────────────────────────────────────────────────────

  /** Резюме из профиля и портфолио. Один запрос — те же источники, что у карточки. */
  private async assemble(
    userId: string,
    options: { withContacts: boolean; labels: ResumeLabels | null },
  ): Promise<ResumeData> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        headline: true,
        email: true,
        phone: true,
        country: true,
        website: true,
        specialty: true,
        course: true,
        graduationYear: true,
        skills: true,
        languages: true,
        university: { select: { name: true } },
        careerProfile: { select: { about: true } },
        portfolioItems: {
          select: {
            kind: true,
            title: true,
            organization: true,
            description: true,
            startDate: true,
            endDate: true,
          },
          orderBy: { order: 'asc' },
          take: 50,
        },
        documents: {
          where: { category: 'CERTIFICATE', status: 'VERIFIED', deletedAt: null },
          select: { title: true, issuedBy: true, issuedAt: true },
          take: 30,
        },
      },
    })
    if (!user) throw new AppException('NOT_FOUND', 'Профиль не найден')

    const period = (from: Date | null, to: Date | null): string | null => {
      const year = (d: Date | null) => (d ? String(d.getFullYear()) : null)
      const a = year(from)
      const b = year(to)
      if (a && b) return a === b ? a : `${a} — ${b}`
      return a ?? b
    }

    const byKind = (kind: string): ResumeItem[] =>
      user.portfolioItems
        .filter((item) => item.kind === kind)
        .map((item) => ({
          title: item.title,
          organization: item.organization,
          period: period(item.startDate, item.endDate),
          description: item.description,
          verified: false,
        }))

    const education = [
      [user.university?.name, user.specialty].filter(Boolean).join(', '),
      [user.course ? `${user.course}` : null, user.graduationYear ? `${user.graduationYear}` : null]
        .filter(Boolean)
        .join(' · '),
    ].filter((line) => line.length > 0)

    return {
      fullName: `${user.firstName} ${user.lastName}`,
      headline: user.headline,
      contacts: options.withContacts
        ? [user.email, user.phone, user.country, user.website].filter((value): value is string =>
            Boolean(value),
          )
        : [],
      about: user.careerProfile?.about ?? null,
      education,
      skills: user.skills,
      languages: user.languages,
      experience: byKind('EXPERIENCE'),
      projects: byKind('PROJECT'),
      certificates: [
        ...byKind('CERTIFICATE'),
        ...user.documents.map((doc) => ({
          title: doc.title,
          organization: doc.issuedBy,
          period: doc.issuedAt ? String(doc.issuedAt.getFullYear()) : null,
          description: null,
          // Подтверждено вузом — главное отличие от самозаявленного сертификата.
          verified: true,
        })),
      ],
      labels: options.labels ?? EMPTY_LABELS,
    }
  }
}

/** Для публичного JSON подписи не нужны — их рисует фронт на своём языке. */
const EMPTY_LABELS: ResumeLabels = {
  about: '',
  education: '',
  skills: '',
  languages: '',
  experience: '',
  projects: '',
  certificates: '',
  verified: '',
  generated: '',
}
