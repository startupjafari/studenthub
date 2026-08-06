import type { ExecutionContext } from '@nestjs/common'
import type { CurrentUserData } from '../../auth/jwt-payload.type'

interface RequestParts {
  user?: CurrentUserData
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
}

// Мок ExecutionContext для unit-тестов guard'ов.
export function mockExecutionContext(request: RequestParts): ExecutionContext {
  const req = { params: {}, query: {}, body: {}, ...request }
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
    getType: () => 'http',
  } as unknown as ExecutionContext
}
