import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { ClientPlatform, ClientVersionInfo } from '@studenthub/shared-schemas'
import type { EnvVars } from '../../config/env.schema'

// Минимальная поддерживаемая версия мобильного клиента (план iOS, Задача Б3).
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
    const storeUrl = this.config.get('IOS_STORE_URL', { infer: true })
    return {
      platform,
      minimumVersion: this.config.get('IOS_MIN_SUPPORTED_VERSION', { infer: true }),
      // Ссылки нет — кнопки «Обновить» на экране тоже не будет: кнопка, ведущая в
      // никуда, хуже её отсутствия.
      ...(storeUrl ? { storeUrl } : {}),
    }
  }
}
