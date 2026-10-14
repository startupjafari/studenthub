import { of } from 'rxjs'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import type { PinoLogger } from 'nestjs-pino'
import { LoggingInterceptor } from './logging.interceptor'

function run(url: string) {
  const info = jest.fn()
  const interceptor = new LoggingInterceptor({ info } as unknown as PinoLogger)
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url, id: 'req-1', headers: {} }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext
  const next: CallHandler = { handle: () => of(null) }
  interceptor.intercept(context, next).subscribe()
  return info.mock.calls[0] as [Record<string, unknown>, string]
}

describe('LoggingInterceptor — секреты в адресе (§13)', () => {
  it('токен инвайта в пути не попадает в лог', () => {
    const [fields, line] = run('/api/v1/invites/0f8c2b7e-secret/preview')
    expect(JSON.stringify(fields)).not.toContain('0f8c2b7e-secret')
    expect(line).not.toContain('0f8c2b7e-secret')
    expect(fields.path).toBe('/api/v1/invites/[token]/preview')
  })

  it('?token= и ?code= заменяются, остальной query остаётся', () => {
    const [fields] = run('/api/v1/student-id/verify?token=abc123&lang=ru')
    expect(fields.path).toBe('/api/v1/student-id/verify?token=[Filtered]&lang=ru')
  })
})
