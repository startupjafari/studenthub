import { InviteStatus } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { InviteService } from './invites.service'
import { AppException } from '../../common/exceptions/app.exception'
import { hashInviteToken } from './invite-token'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

interface PrismaMock {
  invite: {
    create: jest.Mock
    // findFirst, а не findUnique: поиск идёт по двум значениям сразу — хэшу и (переходно)
    // самому токену, см. invite-token.ts.
    findFirst: jest.Mock
    findUnique: jest.Mock
    update: jest.Mock
  }
}

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const deanA: JwtPayload = {
  sub: 'dean-1',
  role: Role.DEAN,
  universityId: 'uni-A',
  facultyId: 'fac-A',
  groupId: null,
}

function setup() {
  const prisma: PrismaMock = {
    invite: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') }
  const service = new InviteService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, audit, queue, config }
}

const HOUR = 3_600_000

describe('InviteService', () => {
  describe('create', () => {
    it('создаёт инвайт с выведенным scope и пишет аудит', async () => {
      const { service, prisma, audit } = setup()
      prisma.invite.create.mockResolvedValue({ id: 'inv-1', token: 'tok', role: Role.STAROSTA })

      await service.create(deanA, { role: Role.STAROSTA, groupId: 'grp-1' }, ctx)

      const arg = prisma.invite.create.mock.calls[0][0]
      expect(arg.data).toMatchObject({
        role: Role.STAROSTA,
        universityId: 'uni-A',
        facultyId: 'fac-A',
        groupId: 'grp-1',
        createdById: 'dean-1',
      })
      expect(typeof arg.data.token).toBe('string')
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invite_created', entityId: 'inv-1' }),
      )
    })

    it('нарушение иерархии → FORBIDDEN, prisma не вызывается', async () => {
      const { service, prisma } = setup()
      await expect(
        service.create(deanA, { role: Role.UNIVERSITY_ADMIN, universityId: 'uni-A' }, ctx),
      ).rejects.toBeInstanceOf(AppException)
      expect(prisma.invite.create).not.toHaveBeenCalled()
    })

    it('с email ставит письмо-приглашение в очередь email (jobId по хэшу токена)', async () => {
      const { service, prisma, queue } = setup()
      prisma.invite.create.mockResolvedValue({ id: 'inv-1', token: 'x', role: Role.STUDENT })

      const res = await service.create(
        deanA,
        { role: Role.STUDENT, groupId: 'grp-1', email: 'stud@demo.kz' },
        ctx,
      )

      expect(queue.enqueue).toHaveBeenCalledTimes(1)
      const [queueName, jobName, payload, opts] = queue.enqueue.mock.calls[0]
      expect(queueName).toBe('email')
      expect(jobName).toBe('send-invite')
      expect(payload).toMatchObject({ to: 'stud@demo.kz', roleLabel: 'Студент' })
      // В ссылку идёт СЫРОЙ токен (иначе по ней не зарегистрироваться), в jobId — хэш.
      expect(payload.inviteUrl).toBe(`http://localhost:3000/register?token=${res.token}`)
      expect(opts).toEqual({ jobId: `invite:${hashInviteToken(res.token)}` })
    })

    // Токен — это право завести учётку с заданной ролью. В базе он лежать открытым
    // не должен: чтение бэкапа или реплики иначе равно возможности зарегистрироваться
    // по чужому приглашению, в том числе деканом.
    it('в базу пишется хэш, а наружу отдаётся сырой токен', async () => {
      const { service, prisma } = setup()
      prisma.invite.create.mockResolvedValue({ id: 'inv-1', token: 'СЮДА-ПОПАЛ-ХЭШ' })

      const res = await service.create(deanA, { role: Role.STAROSTA, groupId: 'grp-1' }, ctx)

      const stored = prisma.invite.create.mock.calls[0][0].data.token
      expect(stored).toBe(hashInviteToken(res.token))
      expect(stored).not.toBe(res.token)
      // 64 hex-символа sha256 — а не UUID.
      expect(stored).toMatch(/^[0-9a-f]{64}$/)
      expect(res.token).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('без email письмо в очередь не ставится', async () => {
      const { service, prisma, queue } = setup()
      prisma.invite.create.mockResolvedValue({ id: 'inv-1', token: 'x', role: Role.STAROSTA })

      await service.create(deanA, { role: Role.STAROSTA, groupId: 'grp-1' }, ctx)

      expect(queue.enqueue).not.toHaveBeenCalled()
    })

    it('сбой очереди (Redis) не роняет создание инвайта — токен всё равно возвращается', async () => {
      const { service, prisma, queue } = setup()
      prisma.invite.create.mockResolvedValue({ id: 'inv-1', token: 'x', role: Role.STUDENT })
      queue.enqueue.mockRejectedValue(new Error('redis down'))

      const res = await service.create(
        deanA,
        { role: Role.STUDENT, groupId: 'grp-1', email: 'stud@demo.kz' },
        ctx,
      )

      expect(res).toMatchObject({ id: 'inv-1' })
    })
  })

  describe('preview', () => {
    const base = {
      role: Role.STUDENT,
      email: null,
      universityId: 'uni-A',
      facultyId: 'fac-A',
      groupId: 'grp-A',
    }

    it('не найден → NOT_FOUND', async () => {
      const { service, prisma } = setup()
      prisma.invite.findFirst.mockResolvedValue(null)
      await expect(service.preview('x')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('USED → INVITE_USED', async () => {
      const { service, prisma } = setup()
      prisma.invite.findFirst.mockResolvedValue({
        ...base,
        status: InviteStatus.USED,
        expiresAt: new Date(Date.now() + HOUR),
      })
      await expect(service.preview('x')).rejects.toMatchObject({ code: 'INVITE_USED' })
    })

    it('REVOKED → INVITE_REVOKED', async () => {
      const { service, prisma } = setup()
      prisma.invite.findFirst.mockResolvedValue({
        ...base,
        status: InviteStatus.REVOKED,
        expiresAt: new Date(Date.now() + HOUR),
      })
      await expect(service.preview('x')).rejects.toMatchObject({ code: 'INVITE_REVOKED' })
    })

    it('PENDING но просрочен → INVITE_EXPIRED', async () => {
      const { service, prisma } = setup()
      prisma.invite.findFirst.mockResolvedValue({
        ...base,
        status: InviteStatus.PENDING,
        expiresAt: new Date(Date.now() - HOUR),
      })
      await expect(service.preview('x')).rejects.toMatchObject({ code: 'INVITE_EXPIRED' })
    })

    it('валидный PENDING → данные без email/создателя', async () => {
      const { service, prisma } = setup()
      const expiresAt = new Date(Date.now() + HOUR)
      prisma.invite.findFirst.mockResolvedValue({
        ...base,
        status: InviteStatus.PENDING,
        expiresAt,
      })
      const result = await service.preview('x')
      expect(result).toEqual({
        role: Role.STUDENT,
        emailRequired: true,
        universityId: 'uni-A',
        facultyId: 'fac-A',
        groupId: 'grp-A',
        expiresAt,
      })
      // Адрес наружу не уходит: превью публично по токену, а ссылку могли переслать
      // кому угодно. Форме достаточно признака emailRequired.
      expect(result).not.toHaveProperty('email')
      expect(result).not.toHaveProperty('createdById')
    })

    it('у инвайта есть email → emailRequired = false, адрес не раскрывается', async () => {
      const { service, prisma } = setup()
      prisma.invite.findFirst.mockResolvedValue({
        ...base,
        email: 'student@uni.kz',
        status: InviteStatus.PENDING,
        expiresAt: new Date(Date.now() + HOUR),
      })
      const result = await service.preview('x')
      expect(result).toMatchObject({ emailRequired: false })
      expect(result).not.toHaveProperty('email')
    })
  })

  describe('revoke', () => {
    it('не найден → NOT_FOUND', async () => {
      const { service, prisma } = setup()
      prisma.invite.findUnique.mockResolvedValue(null)
      await expect(service.revoke(deanA, 'inv', ctx)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('не создатель и не админ → FORBIDDEN', async () => {
      const { service, prisma } = setup()
      prisma.invite.findUnique.mockResolvedValue({
        id: 'inv',
        status: InviteStatus.PENDING,
        createdById: 'someone-else',
        universityId: 'uni-B',
      })
      await expect(service.revoke(deanA, 'inv', ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('создатель отзывает PENDING', async () => {
      const { service, prisma, audit } = setup()
      prisma.invite.findUnique.mockResolvedValue({
        id: 'inv',
        status: InviteStatus.PENDING,
        createdById: 'dean-1',
        universityId: 'uni-A',
      })
      prisma.invite.update.mockResolvedValue({})
      const res = await service.revoke(deanA, 'inv', ctx)
      expect(res).toEqual({ id: 'inv', status: InviteStatus.REVOKED })
      expect(prisma.invite.update).toHaveBeenCalledWith({
        where: { id: 'inv' },
        data: { status: InviteStatus.REVOKED },
      })
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invite_revoked' }),
      )
    })

    it('уже USED → CONFLICT', async () => {
      const { service, prisma } = setup()
      prisma.invite.findUnique.mockResolvedValue({
        id: 'inv',
        status: InviteStatus.USED,
        createdById: 'dean-1',
        universityId: 'uni-A',
      })
      await expect(service.revoke(deanA, 'inv', ctx)).rejects.toMatchObject({ code: 'CONFLICT' })
    })
  })
})
