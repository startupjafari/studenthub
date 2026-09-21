// Лист графа импортов: файл не импортирует ничего и потому может быть импортирован
// откуда угодно, не втягивая за собой домен auth.
//
// Прямой импорт TwoFactorService в ActionConfirmGuard замыкает кольцо
// auth.module → guard → two-factor.service → users.service → auth.service → two-factor,
// и TwoFactorService оказывается undefined в момент, когда Nest читает метаданные
// AuthService. Запуск падает, а типы и тесты этого не видят — проверено дважды, оба раза
// поймано только реальным стартом приложения.

export const ACTION_CONFIRMATION = Symbol('ACTION_CONFIRMATION')

export interface ActionConfirmation {
  /** Верен ли код второго фактора для этого человека. */
  verifyForUser(userId: string, code: string): Promise<boolean>
}
