/**
 * Разбор и сборка полезной нагрузки APNs (план iOS, Задача Б1).
 *
 * Вынесено из сервиса ради тестов: оба решения — что класть в пуш и что делать с
 * ответом Apple — чистые, и проверять их живым HTTP/2-соединением было бы нечем.
 */

export interface ApnsMessage {
  title?: string
  body?: string
  /** Число на иконке. Ноль гасит бейдж, `undefined` — не трогает его вовсе. */
  badge?: number
  /** Куда ведёт нажатие. Относительный путь превращаем в ссылку своей схемы. */
  url?: string
  /** Тихий пуш: без текста, только повод сходить за данными. */
  silent?: boolean
}

/** Чем закончилась отправка на одно устройство. */
export type ApnsOutcome = 'delivered' | 'retry' | 'gone' | 'disabled'

/** Тихий уходит без `alert`: алерт с пустым текстом показал бы пустую плашку. */
export function buildApnsPayload(message: ApnsMessage): string {
  const aps: Record<string, unknown> = {}
  if (message.silent) {
    aps['content-available'] = 1
  } else {
    aps.alert = { title: message.title ?? '', body: message.body ?? '' }
    aps.sound = 'default'
  }
  if (message.badge !== undefined) aps.badge = message.badge
  return JSON.stringify({ aps, ...(message.url ? { url: message.url } : {}) })
}

/**
 * 410 и `BadDeviceToken` означают, что адреса больше нет: приложение удалили или
 * переустановили, и строку нужно вычистить — иначе каждый следующий пуш стучится
 * в пустоту. Всё остальное — повод попробовать позже, а не выбрасывать устройство.
 */
export function apnsOutcome(status: number, body: string): ApnsOutcome {
  if (status >= 200 && status < 300) return 'delivered'
  let reason: string | undefined
  try {
    reason = (JSON.parse(body) as { reason?: string }).reason
  } catch {
    reason = undefined
  }
  if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') return 'gone'
  return 'retry'
}
