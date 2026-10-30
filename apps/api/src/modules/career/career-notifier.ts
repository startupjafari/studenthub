import { Injectable, Logger } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import type { CompanyAccessStatus, VacancyReviewStatus } from '@studenthub/shared-schemas'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { NOTIFICATION_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { NotificationJobData } from '../notifications/notification-job.type'

// Сигналы карьерного контура (D-F28). Студент узнаёт о движении своего отклика, а остальные
// стороны жили без уведомлений: администрация вуза видела заявку компании, только открыв
// очередь, компания о решении по допуску и вакансии и о новом кандидате — только заглянув
// в кабинет. Каждое уведомление — best effort: решение уже записано, и сбой очереди не
// должен превращать его в ошибку для того, кто его принял.

// Состав компании — владелец и рекрутеры: единицы. Администрация вуза — тоже.
const COMPANY_MEMBERS_LIMIT = 100
const UNIVERSITY_ADMINS_LIMIT = 50

/** Куда ведёт уведомление в вебе. */
const LINKS = {
  universityCompanies: '/career/companies',
  employerAccess: '/employer/access',
  employerVacancies: '/employer/vacancies',
  employerCandidates: '/employer/candidates',
} as const

const ACCESS_TITLE: Partial<Record<CompanyAccessStatus, NotificationMessageKey>> = {
  APPROVED: 'career.accessApproved.title',
  REJECTED: 'career.accessRejected.title',
  REVOKED: 'career.accessRevoked.title',
}

const VACANCY_TITLE: Partial<Record<VacancyReviewStatus, NotificationMessageKey>> = {
  APPROVED: 'career.vacancyApproved.title',
  REJECTED: 'career.vacancyRejected.title',
}

@Injectable()
export class CareerNotifier {
  private readonly logger = new Logger(CareerNotifier.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Администрации вуза: компания подала (или повторно подала) заявку на допуск. Решение по
   * ней принимает администратор вуза (PATCH /career/university/companies/:id) — ему и пишем.
   * `requestedAt` в ключе: повторная заявка после отказа — новое событие, а не дубль.
   */
  async accessRequested(access: {
    companyId: string
    universityId: string
    requestedAt: Date
  }): Promise<void> {
    await this.safely(`допуск ${access.companyId}:${access.universityId}`, async () => {
      const [company, admins] = await Promise.all([
        this.prisma.company.findFirst({
          where: { id: access.companyId },
          select: { name: true },
        }),
        this.prisma.user.findMany({
          where: {
            universityId: access.universityId,
            role: Role.UNIVERSITY_ADMIN,
            deletedAt: null,
            isBlocked: false,
          },
          select: { id: true },
          take: UNIVERSITY_ADMINS_LIMIT,
        }),
      ])
      if (!company || admins.length === 0) return
      const dedupeKey = `company-access-requested:${access.companyId}:${access.universityId}:${access.requestedAt.getTime()}`
      await this.send({
        recipientIds: admins.map((u) => u.id),
        type: 'APP_UPDATE',
        titleKey: 'career.accessRequested.title',
        bodyKey: 'career.accessRequested.body',
        params: { company: company.name },
        data: { url: LINKS.universityCompanies },
        dedupeKey,
      })
    })
  }

  /** Компании: вуз одобрил, отклонил или отозвал допуск. Причина — в теле, если её указали. */
  async accessDecided(decision: {
    accessId: string
    companyId: string
    universityId: string
    status: CompanyAccessStatus
    reason?: string | null
    decidedAt: Date
  }): Promise<void> {
    const titleKey = ACCESS_TITLE[decision.status]
    if (!titleKey) return
    await this.safely(`решение по допуску ${decision.accessId}`, async () => {
      const [recipientIds, university] = await Promise.all([
        this.companyMemberIds(decision.companyId),
        this.universityName(decision.universityId),
      ])
      if (recipientIds.length === 0) return
      const reason = decision.reason?.trim()
      const dedupeKey = `company-access:${decision.accessId}:${decision.status}:${decision.decidedAt.getTime()}`
      await this.send({
        recipientIds,
        type: 'APP_UPDATE',
        titleKey,
        bodyKey: reason ? 'career.universityReason.body' : 'career.university.body',
        params: { university, ...(reason ? { reason } : {}) },
        data: { url: LINKS.employerAccess },
        dedupeKey,
      })
    })
  }

  /**
   * Компании: допуск закрылся по сроку (cron `expireCompanyAccess`). Своим заголовком, а не
   * «отозван»: решения вуза здесь не было, и компания должна понять, что это срок, который
   * можно продлить повторной заявкой, а не претензия к ней.
   */
  async accessExpired(access: {
    accessId: string
    companyId: string
    universityId: string
    expiredAt: Date
  }): Promise<void> {
    await this.safely(`истечение допуска ${access.accessId}`, async () => {
      const [recipientIds, university] = await Promise.all([
        this.companyMemberIds(access.companyId),
        this.universityName(access.universityId),
      ])
      if (recipientIds.length === 0) return
      await this.send({
        recipientIds,
        type: 'APP_UPDATE',
        titleKey: 'career.accessExpired.title',
        bodyKey: 'career.university.body',
        params: { university },
        data: { url: LINKS.employerAccess },
        dedupeKey: `company-access:${access.accessId}:EXPIRED:${access.expiredAt.getTime()}`,
      })
    })
  }

  /** Компании: вуз одобрил или отклонил вакансию. */
  async vacancyDecided(decision: {
    reviewId: string
    companyId: string
    vacancyTitle: string
    universityId: string
    status: VacancyReviewStatus
    reason?: string | null
    decidedAt: Date
  }): Promise<void> {
    const titleKey = VACANCY_TITLE[decision.status]
    if (!titleKey) return
    await this.safely(`решение по вакансии ${decision.reviewId}`, async () => {
      const [recipientIds, university] = await Promise.all([
        this.companyMemberIds(decision.companyId),
        this.universityName(decision.universityId),
      ])
      if (recipientIds.length === 0) return
      const reason = decision.reason?.trim()
      const dedupeKey = `vacancy-review:${decision.reviewId}:${decision.status}:${decision.decidedAt.getTime()}`
      await this.send({
        recipientIds,
        type: 'APP_UPDATE',
        titleKey,
        bodyKey: reason ? 'career.vacancyReason.body' : 'career.vacancy.body',
        params: { title: decision.vacancyTitle, university, ...(reason ? { reason } : {}) },
        data: { url: LINKS.employerVacancies },
        dedupeKey,
      })
    })
  }

  /**
   * Компании: новый отклик. Свёрнутое уведомление — одна строка на вакансию, которая
   * поднимается с каждым откликом: на популярную вакансию их десятки за день, и строка на
   * каждый засыпала бы колокольчик, а письмо-зеркало уходило бы на каждого кандидата.
   * Имени студента в тексте нет: оно уходит в push-сервисы и почту, а видно по переходу.
   */
  async newApplication(application: {
    id: string
    companyId: string
    vacancyId: string
    vacancyTitle: string
  }): Promise<void> {
    await this.safely(`отклик ${application.id}`, async () => {
      const recipientIds = await this.companyMemberIds(application.companyId)
      if (recipientIds.length === 0) return
      await this.send({
        recipientIds,
        type: 'APP_UPDATE',
        titleKey: 'career.newApplication.title',
        bodyKey: 'career.newApplication.body',
        params: { title: application.vacancyTitle },
        // applicationId — признак события для свёрнутой строки: повтор job'а её не поднимет.
        data: {
          url: LINKS.employerCandidates,
          vacancyId: application.vacancyId,
          applicationId: application.id,
        },
        dedupeKey: `career-application-new:${application.id}`,
        collapseKey: `career-applications:${application.vacancyId}`,
      })
    })
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async companyMemberIds(companyId: string): Promise<string[]> {
    const members = await this.prisma.companyMember.findMany({
      where: { companyId },
      select: { userId: true },
      take: COMPANY_MEMBERS_LIMIT,
    })
    return members.map((m) => m.userId)
  }

  /** Короткое название вуза — так его подписывают в кабинете работодателя. */
  private async universityName(universityId: string): Promise<string> {
    const university = await this.prisma.university.findFirst({
      where: { id: universityId },
      select: { name: true, shortName: true },
    })
    return university?.shortName || university?.name || ''
  }

  private async send(job: NotificationJobData): Promise<void> {
    await this.queue.enqueue(QUEUES.NOTIFICATIONS, NOTIFICATION_JOBS.APPLICATION_UPDATED, job, {
      jobId: job.dedupeKey,
    })
  }

  private async safely(subject: string, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.logger.warn(
        `Карьера, ${subject}: уведомление не поставлено — ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
