import type { ExecutionContext } from '@nestjs/common'
import { Role } from '@studenthub/shared-types'
import { OptionalJwtGuard } from './optional-jwt.guard'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'

function ctx(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => ({}) }),
  } as unknown as ExecutionContext
}

const USER: CurrentUserData = {
  sub: 'u1',
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

describe('OptionalJwtGuard', () => {
  it('без заголовка пропускает анонима, не трогая стратегию', () => {
    const guard = new OptionalJwtGuard()
    expect(guard.canActivate(ctx({}))).toBe(true)
  })

  // Публичный ответ нужен как раз тем, кто не может войти: просроченный, отозванный или
  // чужой токен делает запрос анонимным, а не превращает его в 401.
  it('отказ стратегии — это аноним, а не ошибка', () => {
    const guard = new OptionalJwtGuard()
    expect(guard.handleRequest(new Error('jwt expired'), false)).toBeNull()
    expect(guard.handleRequest(null, false)).toBeNull()
  })

  it('валидный токен кладёт пользователя как есть', () => {
    const guard = new OptionalJwtGuard()
    expect(guard.handleRequest(null, USER)).toBe(USER)
  })
})
