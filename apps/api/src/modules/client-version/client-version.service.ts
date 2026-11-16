import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ClientPlatform, ClientVersionInfo } from '@studenthub/shared-schemas'
import type { EnvVars } from '../../config/env.schema'

// Минимальная поддерживаемая версия мобильного клиента (план iOS, Задача Б3).
//
// Там же — удалённый выключатель рискованных функций (`disabledFeatures`): клиент и так
// спрашивает этот маршрут при запуске и возврате из фона, второй запрос ради списка
// строк был бы лишним.
//
// Значение живёт в переменных окружения, а не в базе, и это осознанно: меняет его
// человек при релизе, читает каждый запуск приложения, истории изменений от него
// не требуется. Таблица ради одной строки на платформу добавила бы миграцию,
// админский экран и путь, которым можно заблокировать всех пользователей опечаткой
// в проде.
@Injectable()
export class ClientVersionService {
  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  info(platform: ClientPlatform): ClientVersionInfo {
    const { minimumVersion, storeUrl, disabledFeatures } = this.settingsFor(platform)
    return {
      platform,
      minimumVersion,
      // Ссылки нет — кнопки «Обновить» на экране тоже не будет: кнопка, ведущая в
      // никуда, хуже её отсутствия.
      ...(storeUrl ? { storeUrl } : {}),
      // Общий список и список платформы — объединением, без повторов: имя, заданное
      // в обоих местах, — не ошибка, а перестраховка человека.
      disabledFeatures: [
        ...new Set([
          ...(this.config.get('CLIENT_DISABLED_FEATURES', { infer: true }) ?? []),
          ...(disabledFeatures ?? []),
        ]),
      ],
    }
  }

  // Явный switch, а не подстановка имени переменной из платформы: так новая платформа
  // в схеме не соберётся, пока для неё не заведены свои переменные.
  private settingsFor(platform: ClientPlatform): {
    minimumVersion: string
    storeUrl?: string
    disabledFeatures?: string[]
  } {
    switch (platform) {
      case 'ios':
        return {
          minimumVersion: this.config.get('IOS_MIN_SUPPORTED_VERSION', { infer: true }),
          storeUrl: this.config.get('IOS_STORE_URL', { infer: true }),
          disabledFeatures: this.config.get('IOS_DISABLED_FEATURES', { infer: true }),
        }
      case 'android':
        return {
          minimumVersion: this.config.get('ANDROID_MIN_SUPPORTED_VERSION', { infer: true }),
          storeUrl: this.config.get('ANDROID_STORE_URL', { infer: true }),
          disabledFeatures: this.config.get('ANDROID_DISABLED_FEATURES', { infer: true }),
        }
    }
  }
}
