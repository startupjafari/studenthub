import { createHash } from 'node:crypto'
import { PasswordResetService } from './password-reset.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { UserService } from '../users/users.service'
import type { LoginAttemptsService } from './login-attempts.service'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const sha = (raw: string) => createHash('sha256').update(raw).digest('hex')

function setup() {
  const prisma = {
    passwordResetToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn((args: unknown) => args),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const loginAttempts = { unlock: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('https://app.studenthub.kz') }
  const users = {
    findForPasswordReset: jest.fn(),
    setPasswordAfterReset: jest.fn().mockResolvedValue(undefined),
    loginIdentifiersOf: jest.fn().mockResolvedValue({ email: 'aliya@uni.kz', username: 'aliya' }),
  }
  const service = new PasswordResetService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    loginAttempts as unknown as LoginAttemptsService,
    config as unknown as ConfigService<EnvVars, true>,
    users as unknown as UserService,
  )
  return { service, prisma, audit, queue, loginAttempts, users }
}

const account = {
  id: 'u-1',
  email: 'aliya@uni.kz',
  username: 'aliya',
  firstName: 'Алия',
  locale: 'kk',
  isBlocked: false,
}

describe('PasswordResetService.requestReset', () => {
  it('шлёт письмо со ссылкой, а в БД кладёт только хэш токена', async () => {
    const { service, prisma, queue, users } = setup()
    users.findForPasswordReset.mockResolvedValue(account)

    await service.requestReset({ email: 'aliya@uni.kz' }, ctx)

    const stored = prisma.passwordResetToken.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string; expiresAt: Date }
    }
    const payload = queue.enqueue.mock.calls[0]?.[2] as {
      to: string
      locale: string
      resetUrl: string
    }
    const raw = new URL(payload.resetUrl).searchParams.get('token') ?? ''
    expect(payload.to).toBe('aliya@uni.kz')
    // Письмо — на языке получателя.
    expect(payload.locale).toBe('kk')
    expect(payload.resetUrl).toContain('/reset-password?token=')
    expect(stored.data.tokenHash).toBe(sha(raw))
    expect(stored.data.tokenHash).not.toBe(raw)
    // Час, а не сутки: ссылка даёт войти в аккаунт.
    expect(stored.data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000)
  })

  it('новая просьба гасит прежние неиспользованные ссылки', async () => {
    const { service, prisma, users } = setup()
    users.findForPasswordReset.mockResolvedValue(account)

    await service.requestReset({ email: 'aliya@uni.kz' }, ctx)

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-1', usedAt: null } }),
    )
  })

  it('неизвестный адрес — тишина: ни записи, ни письма, ни ошибки', async () => {
    const { service, prisma, queue, users } = setup()
    users.findForPasswordReset.mockResolvedValue(null)

    await expect(service.requestReset({ email: 'nobody@uni.kz' }, ctx)).resolves.toBeUndefined()

    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('заблокированному ссылку не шлём, ответ тот же', async () => {
    const { service, queue, users } = setup()
    users.findForPasswordReset.mockResolvedValue({ ...account, isBlocked: true })

    await expect(service.requestReset({ email: 'aliya@uni.kz' }, ctx)).resolves.toBeUndefined()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('PasswordResetService.reset', () => {
  const input = { token: 'raw-token-raw-token', password: 'Nov0e-parol!' }

  it('гасит токен условным UPDATE, меняет пароль и снимает блокировку подбора', async () => {
    const { service, prisma, users, loginAttempts, audit } = setup()
    prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 't-1', userId: 'u-1' })

    await service.reset(input, ctx)

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha(input.token) } }),
    )
    // Одноразовость и срок — в одном условии: второй параллельный переход получит count 0.
    const where = prisma.passwordResetToken.updateMany.mock.calls[0]?.[0]?.where
    expect(where).toEqual(
      expect.objectContaining({ id: 't-1', usedAt: null, expiresAt: { gt: expect.any(Date) } }),
    )
    expect(users.setPasswordAfterReset).toHaveBeenCalledWith('u-1', input.password)
    expect(loginAttempts.unlock).toHaveBeenCalledWith('aliya@uni.kz')
    expect(loginAttempts.unlock).toHaveBeenCalledWith('aliya')
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'password_reset' }))
  })

  it('использованная или истёкшая ссылка — BAD_REQUEST, пароль не меняется', async () => {
    const { service, prisma, users } = setup()
    prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 't-1', userId: 'u-1' })
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.reset(input, ctx)).rejects.toBeInstanceOf(AppException)
    expect(users.setPasswordAfterReset).not.toHaveBeenCalled()
  })

  it('неизвестный токен — тот же ответ', async () => {
    const { service, prisma, users } = setup()
    prisma.passwordResetToken.findUnique.mockResolvedValue(null)

    await expect(service.reset(input, ctx)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled()
    expect(users.setPasswordAfterReset).not.toHaveBeenCalled()
  })
})
