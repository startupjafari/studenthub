import { Role } from '@studenthub/shared-types'
import { CompaniesService } from './companies.service'
import { CareerAccessService } from './career-access.service'
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
  }
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    company: { findFirst: jest.fn(), update: jest.fn() },
    companyMember: { findUnique: jest.fn() },
    companyUniversityAccess: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
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
    invalidate: jest.fn().mockResolvedValue(undefined),
  }
  const config = { get: jest.fn().mockReturnValue('https://app.studenthub.kz') }

  const service = new CompaniesService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    access as unknown as CareerAccessService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, tx, passwords, audit, queue, access }
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
    const { service, prisma, tx, queue } = setup()
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' })

    const result = await service.signup(signupInput, ctx)

    // Ответ такой же, как при успехе, — эндпоинт не должен работать проверкой адресов.
    expect(result).toEqual({ email: signupInput.email })
    expect(tx.user.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
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

describe('CompaniesService — заявка на допуск', () => {
  function ownerSetup() {
    const s = setup()
    s.prisma.companyMember.findUnique.mockResolvedValue({ companyId: 'co-1', role: 'OWNER' })
    s.prisma.company.findFirst.mockResolvedValue({ status: 'ACTIVE', blockedReason: null })
    s.prisma.university.findFirst.mockResolvedValue({ id: 'uni-1' })
    return s
  }

  it('компания с неподтверждённым email заявку подать не может', async () => {
    const s = ownerSetup()
    s.prisma.company.findFirst.mockResolvedValue({ status: 'PENDING_EMAIL', blockedReason: null })
    await expect(
      s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('заблокированная платформой компания заявку подать не может', async () => {
    const s = ownerSetup()
    s.prisma.company.findFirst.mockResolvedValue({ status: 'BLOCKED', blockedReason: 'спам' })
    await expect(
      s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
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
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue({ id: 'a-1', status: 'APPROVED' })
    await expect(
      s.service.requestAccess(employer, { universityId: 'uni-1' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })

  it('после отказа заявка переоткрывается, а не дублируется', async () => {
    const s = ownerSetup()
    s.prisma.companyUniversityAccess.findUnique.mockResolvedValue({ id: 'a-1', status: 'REJECTED' })

    await s.service.requestAccess(employer, { universityId: 'uni-1', message: 'снова' }, ctx)

    expect(s.prisma.companyUniversityAccess.create).not.toHaveBeenCalled()
    expect(s.prisma.companyUniversityAccess.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a-1' },
        data: expect.objectContaining({ status: 'REQUESTED', reason: null, expiresAt: null }),
      }),
    )
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

  it('сотрудник без вуза в токене получает WRONG_SCOPE', async () => {
    const { service } = setup()
    await expect(
      service.decideAccess(staff(null), 'a-1', { status: 'APPROVED' }, ctx),
    ).rejects.toBeInstanceOf(AppException)
  })
})
