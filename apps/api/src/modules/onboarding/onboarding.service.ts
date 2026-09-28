import { Injectable } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import {
  ONBOARDING_STEPS,
  SKIPPABLE_ONBOARDING_STEPS,
  type OnboardingStep,
  type SkipOnboardingStepInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { UniversityService } from '../universities/universities.service'

/**
 * Состояние одного шага мастера, как его видит веб.
 *
 * `count` — не украшение: «факультетов 0» и «факультетов 12» это разные экраны, и
 * решение, звать ли человека на шаг, принимается по числу, а не по флагу.
 */
export interface OnboardingStepState {
  step: OnboardingStep
  done: boolean
  skipped: boolean
  skippable: boolean
  count: number | null
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly universities: UniversityService,
  ) {}

  /** Состояние мастера своего вуза. */
  async state(viewer: JwtPayload) {
    const universityId = this.requireUniversity(viewer)
    const record = await this.ensureRecord(universityId)
    const university = await this.prisma.university.findUniqueOrThrow({
      where: { id: universityId },
      select: { id: true, name: true, shortName: true, city: true, timezone: true, status: true },
    })

    const counts = await this.counts(universityId)
    const skipped = new Set(record.skippedSteps)

    const steps: OnboardingStepState[] = ONBOARDING_STEPS.map((step) => ({
      step,
      done: this.isDone(step, record.profileConfirmedAt, counts, university.status),
      skipped: skipped.has(step),
      skippable: SKIPPABLE_ONBOARDING_STEPS.includes(step),
      count: counts[step] ?? null,
    }))

    // Требуются все шаги, кроме пропущенных и самого запуска: «launch» не заполняют,
    // им заканчивают, и требовать его от самого себя бессмысленно.
    const required = steps.filter((s) => s.step !== 'launch' && !s.skipped)
    const blocking = required.filter((s) => !s.done).map((s) => s.step)

    return {
      university,
      steps,
      /** Следующий незакрытый шаг — на него мастер и открывается. */
      currentStep: blocking[0] ?? 'launch',
      /** Чего не хватает для запуска. Пустой список — кнопка запуска активна. */
      blocking,
      canLaunch: blocking.length === 0 && university.status !== 'ACTIVE',
      dismissedAt: record.dismissedAt,
      completedAt: record.completedAt,
    }
  }

  /** Шаг «О вузе»: реквизиты проверены человеком. */
  async confirmProfile(viewer: JwtPayload, ctx: RequestContext) {
    const universityId = this.requireUniversity(viewer)
    await this.ensureRecord(universityId)
    await this.prisma.universityOnboarding.update({
      where: { universityId },
      data: { profileConfirmedAt: new Date() },
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'onboarding_profile_confirmed',
      entity: 'University',
      entityId: universityId,
      ...ctx,
    })
    return this.state(viewer)
  }

  /**
   * Пропуск шага. Список пропускаемых закрыт в схеме, здесь проверяется ещё раз:
   * схема защищает форму, а сервис — данные.
   */
  async skip(viewer: JwtPayload, input: SkipOnboardingStepInput, ctx: RequestContext) {
    const universityId = this.requireUniversity(viewer)
    if (!SKIPPABLE_ONBOARDING_STEPS.includes(input.step)) {
      throw new AppException('BAD_REQUEST', 'Этот шаг нельзя пропустить')
    }
    const record = await this.ensureRecord(universityId)
    if (!record.skippedSteps.includes(input.step)) {
      await this.prisma.universityOnboarding.update({
        where: { universityId },
        data: { skippedSteps: { push: input.step } },
      })
    }
    await this.audit.record({
      userId: viewer.sub,
      action: 'onboarding_step_skipped',
      entity: 'University',
      entityId: universityId,
      metadata: { step: input.step },
      ...ctx,
    })
    return this.state(viewer)
  }

  /** Мастер свёрнут. Не пройден: `completedAt` остаётся пустым, и мастер вернётся. */
  async dismiss(viewer: JwtPayload) {
    const universityId = this.requireUniversity(viewer)
    await this.ensureRecord(universityId)
    await this.prisma.universityOnboarding.update({
      where: { universityId },
      data: { dismissedAt: new Date() },
    })
    return this.state(viewer)
  }

  /**
   * Запуск: вуз переходит из PENDING в ACTIVE.
   *
   * Это единственное действие мастера, которое видно людям за пределами кабинета
   * админа: до него вуз заведён, но не работает. Поэтому проверка обязательных шагов
   * делается здесь, на сервере, а не только кнопкой на фронте.
   */
  async launch(viewer: JwtPayload, ctx: RequestContext) {
    const universityId = this.requireUniversity(viewer)
    const current = await this.state(viewer)
    if (current.university.status === 'ACTIVE') {
      throw new AppException('CONFLICT', 'Университет уже запущен')
    }
    if (current.blocking.length > 0) {
      throw new AppException(
        'BAD_REQUEST',
        `Не заполнено обязательное: ${current.blocking.join(', ')}`,
      )
    }

    await this.prisma.$transaction([
      this.prisma.university.update({ where: { id: universityId }, data: { status: 'ACTIVE' } }),
      this.prisma.universityOnboarding.update({
        where: { universityId },
        data: { completedAt: new Date() },
      }),
    ])
    await this.universities.invalidateStats(universityId)

    await this.audit.record({
      userId: viewer.sub,
      action: 'university_launched',
      entity: 'University',
      entityId: universityId,
      ...ctx,
    })
    return this.state(viewer)
  }

  // ── Вспомогательное ────────────────────────────────────────────────────────

  /**
   * Пройденность шага по самим данным — см. комментарий к модели UniversityOnboarding.
   *
   * Счётчики по чужим таблицам читаются здесь напрямую, вопреки общему правилу
   * самодостаточности модуля (BACKEND_RULES §2.1). Причина та же, по которой так же
   * устроен `UniversityService.computeStats`: это одно агрегирующее чтение поперёк
   * всей академической структуры, и разложить его на семь сервисов значит получить
   * семь запросов вместо одного ради чистоты, которую никто не увидит. Ничего, кроме
   * `count`, отсюда наружу не идёт.
   */
  private async counts(universityId: string): Promise<Partial<Record<OnboardingStep, number>>> {
    const [faculties, specialties, groups, rooms, terms, subjects, deans, deanInvites] =
      await this.prisma.$transaction([
        this.prisma.faculty.count({ where: { universityId } }),
        this.prisma.specialty.count({ where: { universityId } }),
        this.prisma.group.count({ where: { faculty: { universityId } } }),
        this.prisma.room.count({ where: { universityId } }),
        this.prisma.term.count({ where: { universityId } }),
        this.prisma.subject.count({ where: { universityId } }),
        this.prisma.user.count({ where: { universityId, role: Role.DEAN, deletedAt: null } }),
        // Выписанное, но ещё не принятое приглашение тоже закрывает шаг: декан уже
        // позван, и держать вуз на этом экране, пока он читает почту, незачем.
        this.prisma.invite.count({
          where: { universityId, role: Role.DEAN, status: 'PENDING' },
        }),
      ])

    return {
      faculties,
      specialties,
      groups,
      rooms,
      terms,
      subjects,
      deans: deans + deanInvites,
    }
  }

  private isDone(
    step: OnboardingStep,
    profileConfirmedAt: Date | null,
    counts: Partial<Record<OnboardingStep, number>>,
    status: string,
  ): boolean {
    if (step === 'profile') return profileConfirmedAt !== null
    if (step === 'launch') return status === 'ACTIVE'
    return (counts[step] ?? 0) > 0
  }

  /**
   * Запись мастера заводится при одобрении заявки, но вузы бывают и старше этой
   * функции — заведённые руками до неё. Для них создаём запись при первом обращении:
   * отсутствие строки не должно превращаться в 404 на своём же кабинете.
   */
  private async ensureRecord(universityId: string) {
    return this.prisma.universityOnboarding.upsert({
      where: { universityId },
      create: { universityId },
      update: {},
      select: {
        profileConfirmedAt: true,
        skippedSteps: true,
        dismissedAt: true,
        completedAt: true,
      },
    })
  }

  private requireUniversity(viewer: JwtPayload): string {
    if (!viewer.universityId) {
      throw new AppException('WRONG_SCOPE', 'У аккаунта нет университета в scope')
    }
    return viewer.universityId
  }
}
