import { Role } from '@studenthub/shared-types'
import { CompaniesService } from './companies.service'
import { CareerAccessService } from './career-access.service'
import type { CareerNotifier } from './career-notifier'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { PasswordService } from '../../common/security/password.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const tx = {
    company: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: { create: jest.fn().mockResolvedValue({ id: 'u-new' }) },
    companyMember: { create: jest.fn() },
    // Решение по заявке тоже идёт транзакцией: отзыв допуска обязан погасить решения
    // по вакансиям этого вуза тем же атомарным шагом.
    companyUniversityAccess: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vacancyUniversityReview: { updateMany: jest.fn() },
  }
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    company: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    companyMember: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    companyUniversityAccess: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    university: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const access = {
    requireCompany: jest.fn().mockReturnValue('co-1'),
    assertCompanyActive: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
  }
  const config = { get: jest.fn().mockReturnValue('https://app.studenthub.kz') }
  // Уведомления сторонам карьеры: сборка и доставка — в career-notifier.spec.ts.
  const notifier = {
    accessRequested: jest.fn().mockResolvedValue(undefined),
    accessDecided: jest.fn().mockResolvedValue(undefined),
    accessExpired: jest.fn().mockResolvedValue(undefined),
  }

  const service = new CompaniesService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    access as unknown as CareerAccessService,
    config as unknown as ConfigService<EnvVars, true>,
    notifier as unknown as CareerNotifier,
  )
  return { service, prisma, tx, passwords, audit, queue, access, notifier }
}

const employer: JwtPayload = {
  sub: 'u-1',
  role: Role.EMPLOYER,
  universityId: null,
  facultyId: null,
  groupId: null,
  companyId: 'co-1',
}

const staff = (universityId: string | null = 'uni-1'): JwtPayload => ({
  sub: 'admin-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId,
  facultyId: null,
  groupId: null,
})

const signupInput = {
  email: 'hr@acme.kz',
  password: 'Secret123!',
  firstName: 'Иван',
  lastName: 'Петров',
  companyName: 'Acme',
  website: undefined,
}

describe('CompaniesService — регистрация работодателя', () => {
  it('создаёт компанию в статусе ожидания и владельца без скоупа вуза', async () => {
    const { service, tx, queue } = setup()
    tx.company.create.mockResolvedValue({ id: 'co-new', name: 'Acme' })

    await service.signup(signupInput, ctx)

    // Компания невидима для вузов, пока email не подтверждён.
    expect(tx.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_EMAIL' }) }),
    )
    // Ключевая гарантия: аккаунт вне вуза — скоуп пустой, доступа к студентам нет.
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: Role.EMPLOYER,
          universityId: null,
          facultyId: null,
          groupId: null,
        }),
      }),
    )
    expect(tx.companyMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'OWNER' }) }),
    )
    expect(queue.enqueue).toHaveBeenCalled()
  })

  it('токен подтверждения в БД не хранится в открытом виде', async () => {
    const { service, tx, queue } = setup()
    tx.company.create.mockResolvedValue({ id: 'co-new', name: 'Acme' })

    await service.signup(signupInput, ctx)

    const stored = tx.company.create.mock.calls[0]?.[0]?.data?.emailVerificationHash as string
    const sentUrl = (queue.enqueue.mock.calls[0]?.[3 - 1] as { verifyUrl: string }).verifyUrl
    expect(stored).toBeTruthy()
    expect(sentUrl).not.toContain(stored)
  })

  it('занятый email не создаёт аккаунт и не отличается в ответе', async () => {
    const { service, prisma, tx, queue, passwords } = setup()
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' })

    const result = await service.signup(signupInput, ctx)

    // Ответ такой же, как при успехе, — эндпоинт не должен работать проверкой адресов.
    expect(result).toEqual({ email: signupInput.email })
    expect(tx.user.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
    // И по времени тоже: дорогой хэш считается и для занятого адреса.
    expect(passwords.hash).toHaveBeenCalled()
  })
})

describe('CompaniesService — подтверждение email', () => {
  it('гасит токен, чтобы ссылка была одноразовой', async () => {
    const { service, prisma } = setup()
    prisma.company.findFirst.mockResolvedValue({ id: 'co-1', emailVerificationExpiresAt: null })

    await service.verifyEmail('raw-token', ctx)

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          emailVerificationHash: null,
          emailVerificationExpiresAt: null,
        }),
      }),
    )
  })

  it('истёкшая ссылка отклоняется', async () => {
    const { service, prisma } = setup()
    prisma.company.findFirst.mockResolvedValue({
      id: 'co-1',
      emailVerificationExpiresAt: new Date(Date.now() - 1000),
    })
    await expect(service.verifyEmail('raw-token', ctx)).rejects.toBeInstanceOf(AppException)
    expect(prisma.company.update).not.toHaveBeenCalled()
  })

  it('неизвестный токен — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.company.findFirst.mockResolvedValue(null)
    await expect(service.verifyEmail('nope', ctx)).rejects.toBeInstanceOf(AppException)
  })
})

describe('CompaniesService — повторное письмо подтверждения', () => {
  it('выдаёт новую ссылку и гасит прежнюю', async () => {
    const { service, prisma, queue } = setup()
    prisma.company.findFirst.mockResolvedValue({ id: 'co-1', name: 'Acme' })

    const result = await service.resendVerification({ email: 'hr@acme.kz' }, ctx)

    expect(result).toEqual({ email: 'hr@acme.kz' })
    const data = prisma.company.update.mock.calls[0]?.[0]?.data as {
      emailVerificationHash: string
      emailVerificationExpiresAt: Date
    }
    // Хэш в записи один: перезапись делает прежнюю ссылку недействительной.
    expect(data.emailVerificationHash).toBeTruthy()
    expect(data.emailVerificationExpiresAt.getTime()).toBeGreaterThan(Date.now())
    const payload = queue.enqueue.mock.calls[0]?.[2] as { to: string; verifyUrl: string }
    expect(payload.to).toBe('hr@acme.kz')
    expect(payload.verifyUrl).not.toContain(data.emailVerificationHash)
  })

  it('ищет только компанию, ждущую подтверждения, по почте её владельца', async () => {
    const { service, prisma } = setup()
    prisma.company.findFirst.mockResolvedValue(null)

    await service.resendVerification({ email: 'hr@acme.kz' }, ctx)

    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING_EMAIL',
          members: {
            some: expect.objectContaining({
              role: 'OWNER',
              user: expect.objectContaining({ email: 'hr@acme.kz', role: Role.EMPLOYER }),
            }),
          },
        }),
      }),
    )
  })

  it('неизвестный или подтверждённый адрес — тот же ответ и без письма', async () => {
    const { service, prisma, queue } = setup()
    prisma.company.findFirst.mockResolvedValue(null)

    const result = await service.resendVerification({ email: 'nobody@acme.kz' }, ctx)

    // Эндпоинт публичный: разный ответ превратил бы его в проверку адресов.
    expect(result).toEqual({ email: 'nobody@acme.kz' })
    expect(prisma.company.update).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('CompaniesService — заявка на допуск', () => {
  function ownerSetup() {
    const s = setup()
    s.prisma.companyMember.findUnique.mockResolvedValue({ companyId: 'co-1', role: 'OWNER' })
    s.prisma.company.findFirst.mockResolvedValue({ status: 'ACTIVE', blockedReason: null })
    s.prisma.university.findFirst.mockResolvedValue({ id: 'uni-1' })
    return s
  }

  // Сами правила статуса (неподтверждённая почта, блокировка) — в career-access.service.spec.ts.
  it('неактивная компания заявку подать не может', async () => {
    const s = ownerSetup()
    s.access.assertCompanyActive.mockRejectedValue(new AppException('FORBIDDEN', 'спам'))
    await expect(
      s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
    expect(s.access.assertCompanyActive).toHaveBeenCalledWith('co-1')
    expect(s.prisma.companyUniversityAccess.create).not.toHaveBeenCalled()
  })

  it('не владелец компании заявку подать не может', async () => {
    const s = ownerSetup()
    s.prisma.companyMember.findUnique.mockResolvedValue({ companyId: 'co-1', role: 'RECRUITER' })
    await expect(
      s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('повторная заявка при открытом доступе — CONFLICT', async () => {
    const s = ownerSetup()
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'APPROVED',
      expiresAt: null,
    })
    await expect(
      s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('истёкший, но не погашенный cron допуск: закрывается каскадом, и заявка подаётся', async () => {
    const s = ownerSetup()
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() - 60_000),
    })

    await s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx)

    // Сначала тот же шаг, что у cron: допуск → REVOKED, решения по вакансиям гаснут.
    expect(s.tx.companyUniversityAccess.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'a-1',
      status: 'APPROVED',
    })
    expect(s.tx.vacancyUniversityReview.updateMany).toHaveBeenCalled()
    // Затем — повторная заявка из REVOKED.
    expect(s.prisma.companyUniversityAccess.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a-1', status: 'REVOKED' },
        data: expect.objectContaining({ status: 'REQUESTED' }),
      }),
    )
  })

  it('после отказа заявка переоткрывается, а не дублируется', async () => {
    const s = ownerSetup()
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue({ id: 'a-1', status: 'REJECTED' })

    await s.service.requestAccess(employer, { universityId: 'uni-1', message: 'снова' }, ctx)

    expect(s.prisma.companyUniversityAccess.create).not.toHaveBeenCalled()
    expect(s.prisma.companyUniversityAccess.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a-1', status: 'REJECTED' },
        data: expect.objectContaining({ status: 'REQUESTED', reason: null, expiresAt: null }),
      }),
    )
  })

  it('вуз успел решить заявку между чтением и повторной подачей → 409 (D-F29)', async () => {
    const s = ownerSetup()
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue({ id: 'a-1', status: 'REVOKED' })
    s.prisma.companyUniversityAccess.updateMany.mockResolvedValue({ count: 0 })
    const err = (await s.service
      .requestAccess(employer, { universityId: 'uni-1', message: 'снова' }, ctx)
      .catch((e: unknown) => e)) as AppException
    expect(err.code).toBe('CONFLICT')
    expect(s.audit.record).not.toHaveBeenCalled()
    expect(s.notifier.accessRequested).not.toHaveBeenCalled()
  })

  // D-F28: администрация вуза узнавала о заявке, только открыв очередь.
  it('новая заявка — уведомление администрации вуза с моментом подачи', async () => {
    const s = ownerSetup()
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue(null)

    await s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx)

    const requestedAt = s.prisma.companyUniversityAccess.create.mock.calls[0][0].data.requestedAt
    expect(requestedAt).toBeInstanceOf(Date)
    expect(s.notifier.accessRequested).toHaveBeenCalledWith({
      companyId: 'co-1',
      universityId: 'uni-1',
      requestedAt,
    })
  })
})

describe('CompaniesService — решение вуза', () => {
  it('заявку чужого вуза изменить нельзя', async () => {
    const { service, prisma } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'REQUESTED',
      companyId: 'co-1',
      universityId: 'uni-OTHER',
    })
    await expect(
      service.decideAccess(staff('uni-1'), 'a-1', { status: 'APPROVED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
    expect(prisma.companyUniversityAccess.update).not.toHaveBeenCalled()
  })

  it('недопустимый переход статуса отклоняется', async () => {
    const { service, prisma } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'REJECTED',
      companyId: 'co-1',
      universityId: 'uni-1',
    })
    // REJECTED → REVOKED бессмысленно: отзывать нечего.
    await expect(
      service.decideAccess(staff(), 'a-1', { status: 'REVOKED', reason: 'нет' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('одобрение сбрасывает кэш допусков — иначе отзыв подвиснет на TTL', async () => {
    const { service, prisma, access } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'REQUESTED',
      companyId: 'co-1',
      universityId: 'uni-1',
    })

    await service.decideAccess(staff(), 'a-1', { status: 'APPROVED' }, ctx)

    expect(access.invalidate).toHaveBeenCalledWith('co-1')
  })

  it('отзыв доступа тоже сбрасывает кэш', async () => {
    const { service, prisma, access } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'APPROVED',
      companyId: 'co-1',
      universityId: 'uni-1',
    })

    await service.decideAccess(staff(), 'a-1', { status: 'REVOKED', reason: 'нарушение' }, ctx)

    expect(access.invalidate).toHaveBeenCalledWith('co-1')
  })

  it('отзыв гасит решения по вакансиям компании В ЭТОМ вузе', async () => {
    const { service, prisma, tx } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'APPROVED',
      companyId: 'co-1',
      universityId: 'uni-1',
    })

    await service.decideAccess(staff(), 'a-1', { status: 'REVOKED', reason: 'нарушение' }, ctx)

    expect(tx.vacancyUniversityReview.updateMany).toHaveBeenCalledTimes(1)
    const args = tx.vacancyUniversityReview.updateMany.mock.calls[0][0]
    // Только этот вуз и только эта компания: у решения всегда пара «вакансия ↔ вуз».
    expect(args.where).toMatchObject({
      universityId: 'uni-1',
      vacancy: { companyId: 'co-1' },
      status: { in: ['PENDING', 'APPROVED'] },
    })
    expect(args.data).toMatchObject({ status: 'REJECTED', decidedById: 'admin-1' })
    expect(args.data.reason).toContain('отозвал допуск')
  })

  it('одобрение и отказ решений по вакансиям не трогают', async () => {
    for (const status of ['APPROVED', 'REJECTED'] as const) {
      const { service, prisma, tx } = setup()
      prisma.companyUniversityAccess.findUnique.mockResolvedValue({
        id: 'a-1',
        status: 'REQUESTED',
        companyId: 'co-1',
        universityId: 'uni-1',
      })

      await service.decideAccess(staff(), 'a-1', { status, reason: 'причина' }, ctx)

      expect(tx.vacancyUniversityReview.updateMany).not.toHaveBeenCalled()
    }
  })

  // D-F28: компания узнавала о решении, только заглянув в кабинет.
  it('решение уходит компании уведомлением — со статусом, причиной и моментом решения', async () => {
    const { service, prisma, tx, notifier } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'REQUESTED',
      companyId: 'co-1',
      universityId: 'uni-1',
    })

    await service.decideAccess(staff(), 'a-1', { status: 'REJECTED', reason: 'мало данных' }, ctx)

    const decidedAt = tx.companyUniversityAccess.updateMany.mock.calls[0][0].data.decidedAt
    expect(notifier.accessDecided).toHaveBeenCalledWith({
      accessId: 'a-1',
      companyId: 'co-1',
      universityId: 'uni-1',
      status: 'REJECTED',
      reason: 'мало данных',
      decidedAt,
    })
  })

  it('сотрудник без вуза в токене получает WRONG_SCOPE', async () => {
    const { service } = setup()
    await expect(
      service.decideAccess(staff(null), 'a-1', { status: 'APPROVED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('решение пишется с условием на ожидаемый статус; параллельное → 409 без аудита (D-F29)', async () => {
    const { service, prisma, tx, audit, access } = setup()
    prisma.companyUniversityAccess.findUnique.mockResolvedValue({
      id: 'a-1',
      status: 'REQUESTED',
      companyId: 'co-1',
      universityId: 'uni-1',
    })
    tx.companyUniversityAccess.updateMany.mockResolvedValue({ count: 0 })

    const err = (await service
      .decideAccess(staff(), 'a-1', { status: 'REJECTED', reason: 'нет' }, ctx)
      .catch((e: unknown) => e)) as AppException

    expect(tx.companyUniversityAccess.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a-1', status: 'REQUESTED' } }),
    )
    expect(err.code).toBe('CONFLICT')
    expect(audit.record).not.toHaveBeenCalled()
    expect(access.invalidate).not.toHaveBeenCalled()
  })
})

describe('CompaniesService — вход работодателя (D-F28)', () => {
  it('компания ждёт подтверждения почты → EMAIL_NOT_VERIFIED', async () => {
    const { service, prisma } = setup()
    prisma.company.findFirst.mockResolvedValue({ status: 'PENDING_EMAIL' })
    await expect(service.loginDenial('co-1')).resolves.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    })
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-1', deletedAt: null } }),
    )
  })

  it('подтверждённая и заблокированная компании вход не закрывают', async () => {
    for (const status of ['ACTIVE', 'BLOCKED']) {
      const { service, prisma } = setup()
      prisma.company.findFirst.mockResolvedValue({ status })
      await expect(service.loginDenial('co-1')).resolves.toBeNull()
    }
  })
})

describe('CompaniesService — уборка неподтверждённых компаний (D-F28)', () => {
  const cutoff = new Date('2026-09-17T00:00:00Z')

  it('захватывает компанию условной записью, удаляет аккаунты участников и пишет аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.company.findMany.mockResolvedValueOnce([{ id: 'co-1', deletedAt: null }])
    prisma.companyMember.findMany.mockResolvedValue([{ userId: 'u-1' }])
    const deleteAccount = jest.fn().mockResolvedValue(undefined)

    await expect(service.purgeUnverified(cutoff, deleteAccount)).resolves.toBe(1)

    expect(prisma.company.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'PENDING_EMAIL',
      createdAt: { lt: cutoff },
    })
    // Условие захвата повторяет отбор: подтвердивший почту между ними не пострадает.
    expect(prisma.company.updateMany).toHaveBeenCalledWith({
      where: { id: 'co-1', status: 'PENDING_EMAIL', deletedAt: null, createdAt: { lt: cutoff } },
      data: expect.objectContaining({ deletedAt: expect.any(Date), emailVerificationHash: null }),
    })
    expect(deleteAccount).toHaveBeenCalledWith('u-1')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'company_unverified_purged',
        entityId: 'co-1',
        metadata: { userIds: ['u-1'] },
      }),
    )
  })

  it('почту подтвердили между выборкой и захватом — аккаунт не трогаем', async () => {
    const { service, prisma, audit } = setup()
    prisma.company.findMany.mockResolvedValueOnce([{ id: 'co-1', deletedAt: null }])
    prisma.company.updateMany.mockResolvedValue({ count: 0 })
    const deleteAccount = jest.fn()

    await expect(service.purgeUnverified(cutoff, deleteAccount)).resolves.toBe(0)

    expect(prisma.companyMember.findMany).not.toHaveBeenCalled()
    expect(deleteAccount).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('компания, захваченная прошлым прогоном, добирается без повторного захвата', async () => {
    const { service, prisma } = setup()
    prisma.company.findMany.mockResolvedValueOnce([{ id: 'co-1', deletedAt: new Date() }])
    prisma.companyMember.findMany.mockResolvedValue([{ userId: 'u-1' }])
    const deleteAccount = jest.fn().mockResolvedValue(undefined)

    await expect(service.purgeUnverified(cutoff, deleteAccount)).resolves.toBe(1)

    expect(prisma.company.updateMany).not.toHaveBeenCalled()
    expect(deleteAccount).toHaveBeenCalledWith('u-1')
  })

  it('сбой удаления аккаунта не роняет прогон: следующие компании разбираются', async () => {
    const { service, prisma, audit } = setup()
    prisma.company.findMany.mockResolvedValueOnce([
      { id: 'co-1', deletedAt: null },
      { id: 'co-2', deletedAt: null },
    ])
    prisma.companyMember.findMany
      .mockResolvedValueOnce([{ userId: 'u-1' }])
      .mockResolvedValueOnce([{ userId: 'u-2' }])
    const deleteAccount = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined)

    await expect(service.purgeUnverified(cutoff, deleteAccount)).resolves.toBe(1)

    expect(deleteAccount).toHaveBeenCalledTimes(2)
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'co-2' }))
  })
})

describe('CompaniesService — очередь заявок вуза', () => {
  const uniAdmin: JwtPayload = {
    sub: 'adm-1',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
  }
  const base = { page: 1, limit: 20, sort: 'createdAt' as const, order: 'desc' as const }

  it('поиск по названию компании и сортировка по колонке доходят до выборки', async () => {
    const { service, prisma } = setup()
    await service.universityAccessList(uniAdmin, {
      ...base,
      search: 'Acme',
      sort: 'name',
      order: 'asc',
    })
    const args = prisma.companyUniversityAccess.findMany.mock.calls[0][0]
    expect(args.where.company).toMatchObject({
      name: { contains: 'Acme', mode: 'insensitive' },
    })
    expect(args.orderBy).toEqual([{ company: { name: 'asc' } }, { requestedAt: 'desc' }])
    expect(prisma.companyUniversityAccess.count.mock.calls[0][0].where).toEqual(args.where)
  })

  it('по умолчанию — по дате заявки, порядок из запроса', async () => {
    const { service, prisma } = setup()
    await service.universityAccessList(uniAdmin, { ...base, order: 'asc' })
    expect(prisma.companyUniversityAccess.findMany.mock.calls[0][0].orderBy).toEqual([
      { requestedAt: 'asc' },
    ])
  })
})

describe('CompaniesService — истечение допуска по сроку', () => {
  const now = new Date('2026-10-17T12:40:00Z')
  const expired = { id: 'a-1', companyId: 'co-1', universityId: 'uni-1' }

  it('истёкший допуск становится отзывом с тем же каскадом на вакансии', async () => {
    const { service, prisma, tx, access, audit } = setup()
    prisma.companyUniversityAccess.findMany.mockResolvedValueOnce([expired])

    await expect(service.expireAccess(now)).resolves.toBe(1)

    // Выборка — только одобренные с наступившим сроком, с пределом.
    expect(prisma.companyUniversityAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'APPROVED', expiresAt: { lte: now } },
        take: expect.any(Number),
      }),
    )
    const update = tx.companyUniversityAccess.updateMany.mock.calls[0][0]
    // Условие повторено в записи: вуз мог успеть отозвать допуск сам.
    expect(update.where).toEqual({ id: 'a-1', status: 'APPROVED', expiresAt: { lte: now } })
    expect(update.data).toMatchObject({ status: 'REVOKED', decidedById: null, decidedAt: now })
    expect(update.data.reason).toContain('срок')
    // expiresAt не стирается — по нему видно, когда допуск кончился.
    expect(update.data).not.toHaveProperty('expiresAt')

    const cascade = tx.vacancyUniversityReview.updateMany.mock.calls[0][0]
    expect(cascade.where).toMatchObject({
      universityId: 'uni-1',
      vacancy: { companyId: 'co-1' },
      status: { in: ['PENDING', 'APPROVED'] },
    })
    expect(cascade.data).toMatchObject({ status: 'REJECTED', decidedById: null })
    expect(cascade.data.reason).toContain('Истёк срок допуска')

    expect(access.invalidate).toHaveBeenCalledWith('co-1')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_access_expired', entityId: 'a-1' }),
    )
  })

  it('компания узнаёт, что допуск истёк', async () => {
    const { service, prisma, notifier } = setup()
    prisma.companyUniversityAccess.findMany.mockResolvedValueOnce([expired])

    await service.expireAccess(now)

    expect(notifier.accessExpired).toHaveBeenCalledWith({
      accessId: 'a-1',
      companyId: 'co-1',
      universityId: 'uni-1',
      expiredAt: now,
    })
  })

  it('допуск, который вуз уже отозвал сам, второй раз не закрывается', async () => {
    const { service, prisma, tx, access, notifier } = setup()
    prisma.companyUniversityAccess.findMany.mockResolvedValueOnce([expired])
    tx.companyUniversityAccess.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(service.expireAccess(now)).resolves.toBe(0)

    expect(tx.vacancyUniversityReview.updateMany).not.toHaveBeenCalled()
    expect(access.invalidate).not.toHaveBeenCalled()
    expect(notifier.accessExpired).not.toHaveBeenCalled()
  })

  it('нечего закрывать — ни транзакций, ни сброса кэша', async () => {
    const { service, prisma, access } = setup()

    await expect(service.expireAccess(now)).resolves.toBe(0)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(access.invalidate).not.toHaveBeenCalled()
  })
})

// BUG-216: веб показывал рекрутёру кнопки владельца — роль в компании ему не отдавалась.
describe('CompaniesService — роль смотрящего в карточке своей компании', () => {
  it('отдаёт memberRole и не отдаёт сами строки участников', async () => {
    const { service, prisma } = setup()
    prisma.company.findFirst.mockResolvedValue({
      id: 'co-1',
      name: 'Acme',
      members: [{ role: 'RECRUITER' }],
    })
    const card = await service.myCompany(employer)
    expect(card).toEqual({ id: 'co-1', name: 'Acme', memberRole: 'RECRUITER' })
    expect(prisma.company.findFirst.mock.calls[0][0].select.members).toMatchObject({
      where: { userId: 'u-1' },
    })
  })
})
