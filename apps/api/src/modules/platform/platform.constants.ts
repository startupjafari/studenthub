// Лист графа импортов: файл не импортирует НИЧЕГО и потому может быть импортирован откуда
// угодно, не втягивая за собой остальной модуль.
//
// Это не педантизм. MaintenanceGuard живёт рядом с остальными гардами в AuthModule, а
// PlatformService тянет за собой TwoFactorService → UserService → AuthService, то есть
// существующее кольцо импортов домена auth. Импортируй guard сам класс сервиса — кольцо
// развернулось бы в неудачном порядке, и TwoFactorService оказался бы undefined в момент,
// когда Nest читает метаданные AuthService. Ни типы, ни тесты этого не видят: падает
// только запуск.
//
// Guard'у нужен один вопрос, а не весь сервис, — интерфейс ровно из него и состоит.

export const PLATFORM_STATE = Symbol('PLATFORM_STATE')

export interface NotificationPolicy {
  /** Часы тишины по времени сервера; null — тишины нет. */
  quietFrom: number | null
  quietTo: number | null
  /** Виды уведомлений, которые не слать. */
  muted: string[]
  /** Дежурный: когда задан, уведомления уходят только ему. */
  dutyUserId: string | null
  /** Час ежедневной сводки по времени сервера; null — сводку не слать. */
  digestHour: number | null
}

export interface PlatformStateReader {
  /** Идут ли техработы прямо сейчас. */
  maintenanceActive(now?: Date): Promise<boolean>
  /** Кого и когда уведомлять. Читается перед каждой отправкой в Telegram. */
  notificationPolicy(): Promise<NotificationPolicy>
}
