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

  // У платформ свои планки: релизы выходят в разное время, и минимальная версия iOS
  // не должна блокировать Android, и наоборот.
  it('для Android берёт свои переменные, а не iOS', () => {
    const service = serviceWith({
      IOS_MIN_SUPPORTED_VERSION: '2.0.0',
      IOS_STORE_URL: 'https://apps.apple.com/app/id1',
      ANDROID_MIN_SUPPORTED_VERSION: '1.1.0',
      ANDROID_STORE_URL: 'https://play.google.com/store/apps/details?id=kz.studenthub.app',
    })

    expect(service.info('android')).toEqual({
      platform: 'android',
      minimumVersion: '1.1.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=kz.studenthub.app',
    })
  })
})
