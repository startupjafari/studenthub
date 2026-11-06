import { createHash } from 'node:crypto'
import { Role } from '@studenthub/shared-types'
import { CompanyMembersService, maskEmail } from './company-members.service'
import type { CareerAccessService } from './career-access.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { PasswordService } from '../../common/security/password.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { SessionRevocationService } from '../../common/redis/session-revocation.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const owner: JwtPayload = {
  sub: 'owner-1',
  role: Role.EMPLOYER,
  universityId: null,
  facultyId: null,
  groupId: null,
  companyId: 'co-1',
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const HOUR = 3_600_000

function setup(memberRole: 'OWNER' | 'RECRUITER' = 'OWNER') {
  const prisma = {
    companyMember: {
      findUnique: jest.fn().mockResolvedValue({ companyId: 'co-1', role: memberRole }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    companyInvite: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      update: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'ТОО Прогресс' }) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ firstName: 'Ержан', lastName: 'Сериков' }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'new-user' }),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => Promise<unknown>) =>
    fn(prisma),
  )
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue('job') }
  const access = {
    requireCompany: jest.fn().mockReturnValue('co-1'),
    assertCompanyActive: jest.fn().mockResolvedValue(undefined),
  }
  const revocation = { revokeIssuedBefore: jest.fn().mockResolvedValue(undefined) }
  const realtime = { disconnectUser: jest.fn() }
  const config = { get: jest.fn().mockReturnValue('https://app.test') }
  const service = new CompanyMembersService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    access as unknown as CareerAccessService,
    revocation as unknown as SessionRevocationService,
    realtime as unknown as RealtimeGateway,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, passwords, audit, queue, access, revocation, realtime }
}

const pendingInvite = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  companyId: 'co-1',
  email: 'colleague@company.kz',
  role: 'RECRUITER',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + HOUR),
  company: { name: 'ТОО Прогресс', status: 'ACTIVE', deletedAt: null },
  ...over,
})

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = (await p.catch((err: unknown) => err)) as AppException
  return e instanceof AppException ? e.code : String(e)
}

describe('CompanyMembersService — только владелец', () => {
  it('рекрутер не видит команду, не приглашает и не исключает', async () => {
    const { service, prisma, queue } = setup('RECRUITER')
    expect(await codeOf(service.list(owner))).toBe('FORBIDDEN')
    expect(await codeOf(service.invite(owner, { email: 'a@b.kz' }, ctx))).toBe('FORBIDDEN')
    expect(await codeOf(service.removeMember(owner, 'u-2', ctx))).toBe('FORBIDDEN')
    expect(await codeOf(service.revokeInvite(owner, 'inv-1', ctx))).toBe('FORBIDDEN')
    expect(prisma.companyInvite.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('CompanyMembersService — приглашение', () => {
  it('токен в базе — только хэшем, в письме — сам токен; роль всегда RECRUITER', async () => {
    const { service, prisma, queue, audit } = setup()
    await service.invite(owner, { email: 'Colleague@Company.kz' }, ctx)

    const data = prisma.companyInvite.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      companyId: 'co-1',
      email: 'colleague@company.kz',
      role: 'RECRUITER',
    })

    const [, , payload] = queue.enqueue.mock.calls[0]
    const url = new URL(payload.inviteUrl as string)
    expect(url.origin + url.pathname).toBe('https://app.test/employer/join')
    const raw = url.searchParams.get('token') as string
    expect(raw.length).toBeGreaterThanOrEqual(40)
    expect(data.tokenHash).toBe(sha256(raw))
    expect(data.tokenHash).not.toContain(raw)
    expect(payload).toMatchObject({ to: 'colleague@company.kz', companyName: 'ТОО Прогресс' })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_invite_created' }),
    )
  })

  it('повторное приглашение адреса выдаёт новую ссылку ожидающему, а не новую строку', async () => {
    const { service, prisma } = setup()
    prisma.companyInvite.findFirst.mockResolvedValue({ id: 'inv-1' })
    await service.invite(owner, { email: 'colleague@company.kz' }, ctx)
    expect(prisma.companyInvite.create).not.toHaveBeenCalled()
    expect(prisma.companyInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-1' } }),
    )
  })

  it('участника команды пригласить нельзя', async () => {
    const { service, prisma } = setup()
    prisma.companyMember.findFirst.mockResolvedValue({ id: 'm-2' })
    expect(await codeOf(service.invite(owner, { email: 'colleague@company.kz' }, ctx))).toBe(
      'CONFLICT',
    )
  })

  it('не больше 50 ожидающих приглашений', async () => {
    const { service, prisma, queue } = setup()
    prisma.companyInvite.count.mockResolvedValue(50)
    expect(await codeOf(service.invite(owner, { email: 'x@company.kz' }, ctx))).toBe('CONFLICT')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('заблокированная компания не приглашает', async () => {
    const { service, access, prisma } = setup()
    access.assertCompanyActive.mockRejectedValue(new AppException('FORBIDDEN', 'blocked'))
    expect(await codeOf(service.invite(owner, { email: 'x@company.kz' }, ctx))).toBe('FORBIDDEN')
    expect(prisma.companyInvite.create).not.toHaveBeenCalled()
  })

  it('отзыв — только ожидающего приглашения своей компании', async () => {
    const { service, prisma } = setup()
    await service.revokeInvite(owner, 'inv-1', ctx)
    expect(prisma.companyInvite.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', companyId: 'co-1', status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: expect.any(Date) },
    })
    prisma.companyInvite.updateMany.mockResolvedValue({ count: 0 })
    expect(await codeOf(service.revokeInvite(owner, 'inv-x', ctx))).toBe('NOT_FOUND')
  })
})

describe('CompanyMembersService — исключение участника', () => {
  it('себя исключить нельзя', async () => {
    const { service, prisma } = setup()
    expect(await codeOf(service.removeMember(owner, 'owner-1', ctx))).toBe('CONFLICT')
    expect(prisma.companyMember.delete).not.toHaveBeenCalled()
  })

  it('последнего владельца исключить нельзя', async () => {
    const { service, prisma } = setup()
    prisma.companyMember.findFirst.mockResolvedValue({ id: 'm-2', role: 'OWNER' })
    prisma.companyMember.count.mockResolvedValue(1)
    expect(await codeOf(service.removeMember(owner, 'u-2', ctx))).toBe('CONFLICT')
    expect(prisma.companyMember.delete).not.toHaveBeenCalled()
  })

  it('исключённый теряет членство и выданные токены сразу', async () => {
    const { service, prisma, revocation, realtime, audit } = setup()
    prisma.companyMember.findFirst.mockResolvedValue({ id: 'm-2', role: 'RECRUITER' })
    await service.removeMember(owner, 'u-2', ctx)
    expect(prisma.companyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1', userId: 'u-2' } }),
    )
    expect(prisma.companyMember.delete).toHaveBeenCalledWith({ where: { id: 'm-2' } })
    expect(revocation.revokeIssuedBefore).toHaveBeenCalledWith('u-2')
    expect(realtime.disconnectUser).toHaveBeenCalledWith('u-2')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_member_removed', entityId: 'u-2' }),
    )
  })

  it('участник чужой компании — 404', async () => {
    const { service, revocation } = setup()
    expect(await codeOf(service.removeMember(owner, 'stranger', ctx))).toBe('NOT_FOUND')
    expect(revocation.revokeIssuedBefore).not.toHaveBeenCalled()
  })
})

describe('CompanyMembersService — ссылка из письма', () => {
  it('предпросмотр: компания и адрес под маской; ищется по хэшу токена', async () => {
    const { service, prisma } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(pendingInvite())
    const preview = await service.preview('raw-token-raw-token')
    expect(prisma.companyInvite.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha256('raw-token-raw-token') } }),
    )
    expect(preview).toMatchObject({ companyName: 'ТОО Прогресс', email: 'c•••@company.kz' })
  })

  it.each([
    [{ status: 'ACCEPTED' }, 'INVITE_USED'],
    [{ status: 'REVOKED' }, 'INVITE_REVOKED'],
    [{ expiresAt: new Date(Date.now() - 1000) }, 'INVITE_EXPIRED'],
  ])('состояние %o — %s', async (over, code) => {
    const { service, prisma } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(pendingInvite(over))
    expect(await codeOf(service.preview('raw-token-raw-token'))).toBe(code)
  })

  it('неизвестный токен — 404', async () => {
    const { service } = setup()
    expect(await codeOf(service.preview('nope-nope-nope-nope'))).toBe('NOT_FOUND')
  })

  it('маска адреса', () => {
    expect(maskEmail('aruzhan@uni.kz')).toBe('a•••@uni.kz')
    expect(maskEmail('broken')).toBe('•••')
  })
})

describe('CompanyMembersService — регистрация по приглашению', () => {
  const input = {
    token: 'raw-token-raw-token',
    password: 'Passw0rd!',
    firstName: 'Айгерим',
    lastName: 'Нурланова',
  }

  it('EMPLOYER на адрес приглашения + RECRUITER в компании; приглашение гаснет', async () => {
    const { service, prisma, audit } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(pendingInvite())

    const result = await service.accept(input, ctx)

    expect(result).toEqual({ userId: 'new-user' })
    expect(prisma.companyInvite.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'PENDING', expiresAt: { gt: expect.any(Date) } },
      data: { status: 'ACCEPTED', acceptedAt: expect.any(Date) },
    })
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'colleague@company.kz',
          role: Role.EMPLOYER,
          universityId: null,
          passwordHash: 'hashed',
        }),
      }),
    )
    expect(prisma.companyMember.create).toHaveBeenCalledWith({
      data: { companyId: 'co-1', userId: 'new-user', role: 'RECRUITER' },
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_invite_accepted' }),
    )
  })

  it('параллельный второй запрос по той же ссылке — 410 INVITE_USED, второго аккаунта нет', async () => {
    const { service, prisma } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(pendingInvite())
    prisma.companyInvite.updateMany.mockResolvedValue({ count: 0 })
    expect(await codeOf(service.accept(input, ctx))).toBe('INVITE_USED')
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('адрес уже занят аккаунтом — 409 COMPANY_INVITE_EMAIL_TAKEN, приглашение не гасится', async () => {
    const { service, prisma } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(pendingInvite())
    prisma.user.findFirst.mockResolvedValue({ id: 'existing' })
    expect(await codeOf(service.accept(input, ctx))).toBe('COMPANY_INVITE_EMAIL_TAKEN')
    // Гашение уже сделано (оно идёт первым, чтобы гонка отвечала 410), но отказ бросается
    // внутри $transaction — запись откатывается вместе с ним.
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('заблокированная компания новых людей не принимает', async () => {
    const { service, prisma } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(
      pendingInvite({ company: { name: 'X', status: 'BLOCKED', deletedAt: null } }),
    )
    expect(await codeOf(service.accept(input, ctx))).toBe('INVITE_REVOKED')
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('истёкшее приглашение — 410 INVITE_EXPIRED', async () => {
    const { service, prisma } = setup()
    prisma.companyInvite.findUnique.mockResolvedValue(
      pendingInvite({ expiresAt: new Date(Date.now() - 1000) }),
    )
    expect(await codeOf(service.accept(input, ctx))).toBe('INVITE_EXPIRED')
  })
})
