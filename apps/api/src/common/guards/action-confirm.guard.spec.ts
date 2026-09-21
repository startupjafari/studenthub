import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { ActionConfirmGuard } from './action-confirm.guard'
import { AppException } from '../exceptions/app.exception'
import type { TwoFactorService } from '../../modules/auth/two-factor.service'

function context(user?: { sub: string; client?: string }, body?: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user, body }) }),
  } as unknown as ExecutionContext
}

function setup(required: boolean, codeValid = true) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required || undefined) }
  const twoFactor = { verifyForUser: jest.fn().mockResolvedValue(codeValid) }
  const guard = new ActionConfirmGuard(
    reflector as unknown as Reflector,
    twoFactor as unknown as TwoFactorService,
  )
  return { guard, twoFactor }
}

describe('ActionConfirmGuard', () => {
  it('маршрут без требования пропускает', async () => {
    const { guard, twoFactor } = setup(false)

    await expect(guard.canActivate(context({ sub: 'u1', client: 'mini' }))).resolves.toBe(true)
    expect(twoFactor.verifyForUser).not.toHaveBeenCalled()
  })

  /**
   * В вебе человек прошёл пароль и 2FA в этой же сессии; спрашивать код ещё раз на каждое
   * действие значило бы приучить вводить его не глядя.
   */
  it('из веба код не спрашивает', async () => {
    const { guard, twoFactor } = setup(true)

    await expect(guard.canActivate(context({ sub: 'u1' }))).resolves.toBe(true)
    expect(twoFactor.verifyForUser).not.toHaveBeenCalled()
  })

  // Телефон открывается одним касанием — потерянный аппарат иначе даёт полный доступ.
  it('из мини-аппа без кода отказывает', async () => {
    const { guard } = setup(true)

    await expect(guard.canActivate(context({ sub: 'u1', client: 'mini' }, {}))).rejects.toThrow(
      AppException,
    )
  })

  it('из мини-аппа с неверным кодом отказывает', async () => {
    const { guard } = setup(true, false)

    await expect(
      guard.canActivate(context({ sub: 'u1', client: 'mini' }, { code: '000000' })),
    ).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
  })

  it('из мини-аппа с верным кодом пропускает', async () => {
    const { guard } = setup(true)

    await expect(
      guard.canActivate(context({ sub: 'u1', client: 'mini' }, { code: '123456' })),
    ).resolves.toBe(true)
  })
})

describe('ActionConfirmGuard — условное требование', () => {
  function conditional(body: unknown, valid = true) {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue((b: Record<string, unknown>) => b.action === 'BLOCK_USER'),
    }
    const twoFactor = { verifyForUser: jest.fn().mockResolvedValue(valid) }
    const guard = new ActionConfirmGuard(
      reflector as unknown as Reflector,
      twoFactor as unknown as TwoFactorService,
    )
    return { guard, twoFactor, ctx: context({ sub: 'u1', client: 'mini' }, body) }
  }

  // Спрашивать код на «нарушения нет» — приучить вводить его не глядя.
  it('на безобидном действии код не спрашивает', async () => {
    const { guard, ctx, twoFactor } = conditional({ action: 'DISMISS' })

    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(twoFactor.verifyForUser).not.toHaveBeenCalled()
  })

  it('на блокировке через жалобу код требует', async () => {
    const { guard, ctx } = conditional({ action: 'BLOCK_USER' })

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'INVALID_2FA_CODE' })
  })

  it('на блокировке с верным кодом пропускает', async () => {
    const { guard, ctx } = conditional({ action: 'BLOCK_USER', code: '123456' })

    await expect(guard.canActivate(ctx)).resolves.toBe(true)
  })
})
