import { Injectable } from '@nestjs/common'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { CareerAccessService } from './career-access.service'

/**
 * Метрики карьерного модуля.
 *
 * Считаются агрегатами — ни один запрос здесь не возвращает персональные данные. Это
 * важно именно для карьеры: вуз имеет право видеть, как идёт трудоустройство, но не
 * должен через «аналитику» получать список студентов, скрывших профиль.
 */
@Injectable()
export class CareerAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CareerAccessService,
  ) {}

  /** Сводка по своему вузу: компании, вакансии, воронка. */
  async forUniversity(viewer: JwtPayload) {
    const universityId = viewer.universityId
    if (!universityId) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }

    const [companies, vacancyReviews, applications, profiles] = await Promise.all([
      this.prisma.companyUniversityAccess.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      }),
      this.prisma.vacancyUniversityReview.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      }),
      this.prisma.careerApplication.groupBy({
        by: ['status'],
        where: { universityId },
        _count: { _all: true },
      }),
      this.prisma.careerProfile.count({
        where: { visibility: 'EMPLOYERS', user: { universityId, deletedAt: null } },
      }),
    ])

    const studentsTotal = await this.prisma.user.count({
      where: { universityId, role: 'STUDENT', deletedAt: null },
    })

    const funnel = this.toMap(applications)
    const submitted = Object.values(funnel).reduce((sum, n) => sum + n, 0)

    return {
      companies: this.toMap(companies),
      vacancies: this.toMap(vacancyReviews),
      funnel,
      profiles: {
        // Сколько студентов вообще открыли себя работодателям — базовая метрика модуля.
        visible: profiles,
        total: studentsTotal,
      },
      // Доли считаем здесь, а не на фронте: одна формула на все экраны и отчёты.
      rates: {
        interview: this.rate(funnel.INTERVIEW ?? 0, submitted),
        offer: this.rate(funnel.OFFER ?? 0, submitted),
        hired: this.rate(funnel.HIRED ?? 0, submitted),
      },
    }
  }

  /** Сводка по своей компании: что видит работодатель про собственный подбор. */
  async forCompany(viewer: JwtPayload) {
    const companyId = this.access.requireCompany(viewer)

    const [vacancies, applications, views] = await Promise.all([
      this.prisma.vacancy.groupBy({
        by: ['status'],
        where: { companyId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.careerApplication.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.vacancy.aggregate({
        where: { companyId, deletedAt: null },
        _sum: { views: true },
      }),
    ])

    const funnel = this.toMap(applications)
    const total = Object.values(funnel).reduce((sum, n) => sum + n, 0)

    return {
      vacancies: this.toMap(vacancies),
      funnel,
      views: views._sum.views ?? 0,
      rates: {
        // Отклик на просмотр: показывает, работает ли текст вакансии.
        apply: this.rate(total, views._sum.views ?? 0),
        interview: this.rate(funnel.INTERVIEW ?? 0, total),
        hired: this.rate(funnel.HIRED ?? 0, total),
      },
    }
  }

  /** groupBy → {статус: количество}. */
  private toMap(rows: Array<{ status: string; _count: { _all: number } }>): Record<string, number> {
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]))
  }

  /** Доля в процентах. Ноль в знаменателе — не ошибка, а «ещё нечего считать». */
  private rate(part: number, whole: number): number | null {
    if (whole === 0) return null
    return Math.round((part / whole) * 100)
  }
}
