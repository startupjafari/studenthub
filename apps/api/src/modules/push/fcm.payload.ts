/**
 * Сборка сообщения FCM и разбор ответа (план Android, Задача АБ1).
 *
 * Вынесено из сервиса по той же причине, что `apns.payload.ts`: оба решения чистые,
 * и проверять их живым соединением с Google было бы нечем.
 */
import type { ApnsMessage } from './apns.payload'

/** Сообщение на устройство. Поля те же, что у APNs: отправитель не знает платформу. */
export type DeviceMessage = ApnsMessage

/** Чем закончилась отправка на одно устройство — тот же словарь, что у APNs. */
export type FcmOutcome = 'delivered' | 'retry' | 'gone' | 'disabled'

/**
 * Только `data`, без блока `notification`, и это осознанно. С `notification`
 * уведомление в фоне рисует сама система — без нашего канала, без перехода по
 * ссылке и без языка, который выбрал человек. Data-сообщение всегда приходит в
 * приложение, и плашку собирает оно.
 *
 * Приоритет `high` обязателен: обычный приоритет Android копит до выхода из режима
 * сна, и сообщение из чата приходило бы через полчаса. Тихому высокий не нужен —
 * он лишь повод сходить за данными, когда телефон проснётся.
 *
 * Значения в `data` — только строки: так требует FCM, число он отвергает целиком.
 */
export function buildFcmMessage(token: string, message: DeviceMessage): string {
  const data: Record<string, string> = {}
  if (message.silent) {
    data.silent = '1'
  } else {
    data.title = message.title ?? ''
    data.body = message.body ?? ''
  }
  if (message.url) data.url = message.url
  if (message.badge !== undefined) data.badge = String(message.badge)
  // Плашку собирает приложение — ключ группы ему для стопки по источнику (как thread-id у APNs).
  if (message.tag && !message.silent) data.tag = message.tag

  return JSON.stringify({
    message: {
      token,
      data,
      android: { priority: message.silent ? 'normal' : 'high' },
    },
  })
}

/**
 * `UNREGISTERED` (404) — приложение удалили или токен сменился: строку вычищаем, как
 * при `410` у Apple. `INVALID_ARGUMENT` с упоминанием токена — токен не FCM вовсе
 * (испорченная запись), его тоже незачем хранить. Остальное — перегрузка, квота,
 * сбой у Google — повод попробовать позже, а не выбрасывать устройство.
 */
export function fcmOutcome(status: number, body: string): FcmOutcome {
  if (status >= 200 && status < 300) return 'delivered'

  let errorStatus: string | undefined
  let errorCode: string | undefined
  let message = ''
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        status?: string
        message?: string
        details?: Array<{ '@type'?: string; errorCode?: string }>
      }
    }
    errorStatus = parsed.error?.status
    message = parsed.error?.message ?? ''
    errorCode = parsed.error?.details?.find((detail) =>
      detail['@type']?.endsWith('FcmError'),
    )?.errorCode
  } catch {
    errorStatus = undefined
  }

  if (errorCode === 'UNREGISTERED' || (status === 404 && errorStatus === 'NOT_FOUND')) return 'gone'
  if (errorCode === 'INVALID_ARGUMENT' && /registration token/i.test(message)) return 'gone'
  return 'retry'
}
