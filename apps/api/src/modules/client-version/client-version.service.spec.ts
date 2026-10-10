import { ConfigService } from '@nestjs/config'
import { ClientVersionService } from './client-version.service'
import type { EnvVars } from '../../config/env.schema'

const serviceWith = (env: Record<string, string | undefined>): ClientVersionService =>
  new ClientVersionService({
    get: (key: string) => env[key],
  } as unknown as ConfigService<EnvVars, true>)

describe('ClientVersionService', () => {
  it('отдаёт минимальную версию и ссылку на магазин', () => {
    const service = serviceWith({
      IOS_MIN_SUPPORTED_VERSION: '1.2.0',
      IOS_STORE_URL: 'https://apps.apple.com/app/id1',
    })

    expect(service.info('ios')).toEqual({
      platform: 'ios',
      minimumVersion: '1.2.0',
      storeUrl: 'https://apps.apple.com/app/id1',
    })
  })

  // Кнопка, ведущая в никуда, хуже её отсутствия: без ссылки поля в ответе нет.
  it('без ссылки на магазин не выдумывает её', () => {
    const service = serviceWith({ IOS_MIN_SUPPORTED_VERSION: '1.2.0' })

    expect(service.info('ios')).toEqual({ platform: 'ios', minimumVersion: '1.2.0' })
  })

  // Значение по умолчанию задаёт схема env: '0.0.0' означает «никого не блокируем».
  it('передаёт значение из конфигурации как есть', () => {
    const service = serviceWith({ IOS_MIN_SUPPORTED_VERSION: '0.0.0' })

    expect(service.info('ios').minimumVersion).toBe('0.0.0')
  })
})
