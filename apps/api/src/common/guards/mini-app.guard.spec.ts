import { Reflector } from '@nestjs/core'
import type { ExecutionContext } from '@nestjs/common'
import { MiniAppGuard } from './mini-app.guard'
import { AppException } from '../exceptions/app.exception'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Guard — единственное, что стоит между токеном из Telegram и остальным API. Тесты
// закрывают обе стороны: мини-апп не должен ходить дальше белого списка, а обычный вход
// не должен пострадать от его появления.

describe('MiniAppGuard', () => {
  const contextWith = (user: Partial<CurrentUserData> | undefined): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext

  const guardWith = (allowed: boolean | undefined) => {
    const reflector = { getAllAndOverride: () => allowed } as unknown as Reflector
    return new MiniAppGuard(reflector)
  }

  it('пускает токен мини-аппа на маршрут из белого списка', () => {
    expect(guardWith(true).canActivate(contextWith({ client: 'mini' }))).toBe(true)
  })

  it('отклоняет токен мини-аппа на непомеченном маршруте', () => {
    expect(() => guardWith(undefined).canActivate(contextWith({ client: 'mini' }))).toThrow(
      AppException,
    )
  })

  it('не трогает обычный токен — ни на помеченных маршрутах, ни на прочих', () => {
    expect(guardWith(undefined).canActivate(contextWith({ role: 'PLATFORM_ADMIN' } as never))).toBe(
      true,
    )
    expect(guardWith(true).canActivate(contextWith({ role: 'STUDENT' } as never))).toBe(true)
  })

  it('пропускает запрос без пользователя — это забота JwtAuthGuard, не наша', () => {
    expect(guardWith(undefined).canActivate(contextWith(undefined))).toBe(true)
  })
})
