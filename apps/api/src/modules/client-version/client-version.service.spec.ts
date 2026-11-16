import { ConfigService } from '@nestjs/config'
import { ClientVersionService } from './client-version.service'
import type { EnvVars } from '../../config/env.schema'

const serviceWith = (env: Record<string, string | string[] | undefined>): ClientVersionService =>
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
      disabledFeatures: [],
    })
  })

  // Кнопка, ведущая в никуда, хуже её отсутствия: без ссылки поля в ответе нет.
  it('без ссылки на магазин не выдумывает её', () => {
    const service = serviceWith({ IOS_MIN_SUPPORTED_VERSION: '1.2.0' })

    expect(service.info('ios')).toEqual({
      platform: 'ios',
      minimumVersion: '1.2.0',
      disabledFeatures: [],
    })
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
      disabledFeatures: [],
    })
  })

  // Выключатель: общий список гасит функцию везде, платформенный — только у своей
  // платформы; повтор имени в обоих списках в ответ не дублируется.
  it('выключенные функции — объединение общего списка и списка платформы', () => {
    const service = serviceWith({
      IOS_MIN_SUPPORTED_VERSION: '1.0.0',
      ANDROID_MIN_SUPPORTED_VERSION: '1.0.0',
      CLIENT_DISABLED_FEATURES: ['liveLocation', 'gifSearch'],
      IOS_DISABLED_FEATURES: ['chatVideoUpload', 'liveLocation'],
      ANDROID_DISABLED_FEATURES: ['stickers'],
    })

    expect(service.info('ios').disabledFeatures).toEqual([
      'liveLocation',
      'gifSearch',
      'chatVideoUpload',
    ])
    expect(service.info('android').disabledFeatures).toEqual([
      'liveLocation',
      'gifSearch',
      'stickers',
    ])
  })
})
