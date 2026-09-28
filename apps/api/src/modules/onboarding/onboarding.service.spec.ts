import { Role } from '@studenthub/shared-types'
import { OnboardingService } from './onboarding.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { UniversityService } from '../universities/universities.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const uniAdmin: JwtPayload = {
  sub: 'ua-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

/** Счётчики в том порядке, в котором их читает сервис. */
function counts(over: Partial<Record<string, number>> = {}) {
  const base = {
    faculties: 1,
    specialties: 1,
    groups: 1,
    rooms: 1,
    terms: 1,
    subjects: 1,
    deans: 1,
    deanInvites: 0,
    ...over,
  }
  return [
    base.faculties,
    base.specialties,
    base.groups,
    base.rooms,
    base.terms,
    base.subjects,
    base.deans,
    base.deanInvites,
  ]
}

function setup(
  options: {
    record?: Partial<{
      profileConfirmedAt: Date | null
      skippedSteps: string[]
      dismissedAt: Date | null
      completedAt: Date | null
    }>
    status?: string
    tally?: number[]
  } = {},
) {
  const record = {
    profileConfirmedAt: new Date('2026-09-01T00:00:00Z'),
    skippedSteps: [],
    dismissedAt: null,
    completedAt: null,
    ...options.record,
  }
  const prisma = {
    universityOnboarding: {
      upsert: jest.fn().mockResolvedValue(record),
      update: jest.fn().mockResolvedValue(record),
    },
    university: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'uni-1',
        name: 'Университет',
        shortName: null,
        city: 'Алматы',
        timezone: 'Asia/Almaty',
        status: options.status ?? 'PENDING',
      }),
      update: jest.fn(),
    },
    faculty: { count: jest.fn() },
    specialty: { count: jest.fn() },
    group: { count: jest.fn() },
    room: { count: jest.fn() },
    term: { count: jest.fn() },
    subject: { count: jest.fn() },
    user: { count: jest.fn() },
    invite: { count: jest.fn() },
    $transaction: jest.fn().mockResolvedValue(options.tally ?? counts()),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const universities = { invalidateStats: jest.fn().mockResolvedValue(undefined) }

  const service = new OnboardingService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    universities as unknown as UniversityService,
  )
  return { service, prisma, audit, universities }
}

describe('OnboardingService.state', () => {
  it('считает шаг пройденным по данным, а не по отметке', async () => {
    const { service } = setup({ tally: counts({ faculties: 0 }) })
    const state = await service.state(uniAdmin)

    expect(state.steps.find((s) => s.step === 'faculties')).toMatchObject({ done: false, count: 0 })
    expect(state.currentStep).toBe('faculties')
    expect(state.canLaunch).toBe(false)
  })

  it('пропущенный шаг не держит запуск, но остаётся видимым', async () => {
    const { service } = setup({
      record: { skippedSteps: ['rooms'] },
      tally: counts({ rooms: 0 }),
    })
    const state = await service.state(uniAdmin)

    expect(state.steps.find((s) => s.step === 'rooms')).toMatchObject({
      done: false,
      skipped: true,
      skippable: true,
    })
    expect(state.blocking).toEqual([])
    expect(state.canLaunch).toBe(true)
  })

  it('неподтверждённые реквизиты держат мастер на первом шаге', async () => {
    const { service } = setup({ record: { profileConfirmedAt: null } })
    const state = await service.state(uniAdmin)

    expect(state.currentStep).toBe('profile')
    expect(state.blocking).toContain('profile')
  })

  it('выписанное приглашение декану закрывает шаг наравне с принятым', async () => {
    const { service } = setup({ tally: counts({ deans: 0, deanInvites: 2 }) })
    const state = await service.state(uniAdmin)

    expect(state.steps.find((s) => s.step === 'deans')).toMatchObject({ done: true, count: 2 })
  })

  it('у запущенного вуза запуск не предлагается повторно', async () => {
    const { service } = setup({ status: 'ACTIVE' })
    const state = await service.state(uniAdmin)

    expect(state.steps.find((s) => s.step === 'launch')?.done).toBe(true)
    expect(state.canLaunch).toBe(false)
  })
})

describe('OnboardingService.launch', () => {
  it('не запускает вуз с незаполненными обязательными шагами', async () => {
    const { service, prisma } = setup({ tally: counts({ groups: 0 }) })

    await expect(service.launch(uniAdmin, ctx)).rejects.toBeInstanceOf(AppException)
    expect(prisma.university.update).not.toHaveBeenCalled()
  })

  it('переводит вуз в ACTIVE и сбрасывает кэш статистики', async () => {
    const { service, prisma, universities } = setup()
    // Первый вызов — счётчики, второй — сама транзакция запуска.
    prisma.$transaction.mockResolvedValueOnce(counts()).mockResolvedValue([])

    await service.launch(uniAdmin, ctx)

    expect(prisma.university.update).toHaveBeenCalledWith({
      where: { id: 'uni-1' },
      data: { status: 'ACTIVE' },
    })
    expect(universities.invalidateStats).toHaveBeenCalledWith('uni-1')
  })
})

describe('OnboardingService.skip', () => {
  it('отказывается пропускать шаг, без которого платформа не работает', async () => {
    const { service, prisma } = setup()

    await expect(service.skip(uniAdmin, { step: 'groups' as never }, ctx)).rejects.toBeInstanceOf(
      AppException,
    )
    expect(prisma.universityOnboarding.update).not.toHaveBeenCalled()
  })
})

describe('OnboardingService: чужой scope', () => {
  it('аккаунт без университета не получает чужой мастер', async () => {
    const { service } = setup()
    await expect(service.state({ ...uniAdmin, universityId: null })).rejects.toBeInstanceOf(
      AppException,
    )
  })
})
