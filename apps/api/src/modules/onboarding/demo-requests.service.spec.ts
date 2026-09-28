import { Role } from '@studenthub/shared-types'
import { DemoRequestsService } from './demo-requests.service'
import { AppException } from '../../common/exceptions/app.exception'
import { EMAIL_JOBS } from '../../common/queue'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { InviteService } from '../invites/invites.service'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const admin: JwtPayload = {
  sub: 'pa-1',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}

const form = {
  universityName: 'Университет имени Теста',
  contactName: 'Айгуль Сериковна',
  email: 'rector@example.edu',
  consent: true as const,
}

function setup() {
  const tx = {
    university: { create: jest.fn().mockResolvedValue({ id: 'uni-1', name: 'Университет' }) },
    universityOnboarding: { create: jest.fn() },
  }
  const prisma = {
    universityDemoRequest: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'req-1', universityName: form.universityName }),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : arg,
    ),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const invites = {
    create: jest.fn().mockResolvedValue({
      id: 'inv-1',
      token: 'raw-token',
      expiresAt: new Date('2026-10-01T10:00:00Z'),
    }),
  }
  const config = { get: jest.fn().mockReturnValue('https://app.studenthub.kz') }

  const service = new DemoRequestsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    invites as unknown as InviteService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, tx, audit, queue, invites }
}

describe('DemoRequestsService.submit', () => {
  it('сохраняет момент и версию согласия, а токен — только хэшем', async () => {
    const { service, prisma } = setup()
    await service.submit(form, ctx)

    const data = prisma.universityDemoRequest.create.mock.calls[0][0].data
    expect(data.consentAt).toBeInstanceOf(Date)
    expect(data.consentVersion).toEqual(expect.any(String))
    // 64 hex — sha256. Сырой токен уходит только в ссылку письма.
    expect(data.emailVerificationHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('на повторную заявку с того же адреса отвечает так же, но ничего не пишет', async () => {
    const { service, prisma, queue } = setup()
    prisma.universityDemoRequest.count.mockResolvedValue(1)

    await expect(service.submit(form, ctx)).resolves.toEqual({ email: form.email })
    expect(prisma.universityDemoRequest.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('DemoRequestsService.verifyEmail', () => {
  it('гасит токен и переводит заявку в очередь', async () => {
    const { service, prisma } = setup()
    prisma.universityDemoRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      emailVerificationExpiresAt: new Date(Date.now() + 60_000),
    })

    await service.verifyEmail('raw', ctx)

    expect(prisma.universityDemoRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'NEW', emailVerificationHash: null, emailVerificationExpiresAt: null },
      }),
    )
  })

  it('на просроченную ссылку отвечает ошибкой, а не тихим успехом', async () => {
    const { service, prisma } = setup()
    prisma.universityDemoRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      emailVerificationExpiresAt: new Date(Date.now() - 60_000),
    })

    await expect(service.verifyEmail('raw', ctx)).rejects.toBeInstanceOf(AppException)
  })
})

describe('DemoRequestsService.approve', () => {
  const approved = {
    id: 'req-1',
    status: 'NEW',
    universityName: 'Университет имени Теста',
    city: 'Алматы',
    country: 'KZ',
    contactName: 'Айгуль Сериковна',
    email: 'rector@example.edu',
  }

  it('заводит вуз в PENDING и сразу открывает мастер', async () => {
    const { service, prisma, tx } = setup()
    prisma.universityDemoRequest.findUnique.mockResolvedValue(approved)

    await service.approve(admin, 'req-1', {}, ctx)

    expect(tx.university.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
    )
    expect(tx.universityOnboarding.create).toHaveBeenCalledWith({
      data: { universityId: 'uni-1' },
    })
  })

  it('выдаёт обычное приглашение UNIVERSITY_ADMIN и не шлёт второго письма', async () => {
    const { service, prisma, invites, queue } = setup()
    prisma.universityDemoRequest.findUnique.mockResolvedValue(approved)

    await service.approve(admin, 'req-1', {}, ctx)

    expect(invites.create).toHaveBeenCalledWith(
      admin,
      { role: Role.UNIVERSITY_ADMIN, email: approved.email, universityId: 'uni-1' },
      ctx,
      { notify: false },
    )
    const jobs = queue.enqueue.mock.calls.map((call) => call[1])
    expect(jobs).toEqual([EMAIL_JOBS.SEND_DEMO_APPROVED])
  })

  it('второе одобрение той же заявки не заводит второй вуз', async () => {
    const { service, prisma, tx } = setup()
    prisma.universityDemoRequest.findUnique.mockResolvedValue({ ...approved, status: 'APPROVED' })

    await expect(service.approve(admin, 'req-1', {}, ctx)).rejects.toBeInstanceOf(AppException)
    expect(tx.university.create).not.toHaveBeenCalled()
  })
})

describe('DemoRequestsService.reject', () => {
  it('пишет причину и отправляет письмо с признаком «можно прийти снова»', async () => {
    const { service, prisma, queue } = setup()
    prisma.universityDemoRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      status: 'NEW',
      universityName: form.universityName,
      email: form.email,
    })

    await service.reject(admin, 'req-1', { reason: 'NO_CAPACITY' }, ctx)

    const [, job, payload] = queue.enqueue.mock.calls[0]
    expect(job).toBe(EMAIL_JOBS.SEND_DEMO_REJECTED)
    expect(payload).toMatchObject({ to: form.email, canReapply: true })
    // Внутренней заметки в письме быть не должно ни при каких причинах.
    expect(Object.keys(payload as object)).not.toContain('note')
  })

  it('на «не вуз» письмо не зовёт возвращаться', async () => {
    const { service, prisma, queue } = setup()
    prisma.universityDemoRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      status: 'NEW',
      universityName: form.universityName,
      email: form.email,
    })

    await service.reject(admin, 'req-1', { reason: 'NOT_ELIGIBLE' }, ctx)

    expect(queue.enqueue.mock.calls[0][2]).toMatchObject({ canReapply: false })
  })
})

describe('DemoRequestsService.list', () => {
  it('без фильтра не показывает неподтверждённые формы', async () => {
    const { service, prisma } = setup()
    prisma.$transaction.mockResolvedValue([[], 0])

    await service.list({ page: 1, limit: 20 })

    expect(prisma.universityDemoRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'PENDING_EMAIL' } } }),
    )
  })
})
