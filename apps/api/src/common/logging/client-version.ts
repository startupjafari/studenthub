import type { FastifyRequest } from 'fastify'

// Версия клиента из заголовка `X-Client-Version` (план iOS, Задача Б3).
//
// Нужна в двух местах: в строке лога каждого запроса и тегом в Sentry. Без неё
// «у меня не работает» не связать со сборкой, а у нативного клиента сборок в поле
// столько, сколько людей не нажали «Обновить».

/** Ограничение длины: в лог уходит версия, а не произвольный текст от клиента. */
const MAX_LENGTH = 64

/**
 * Читает и обезвреживает заголовок.
 *
 * Значение приходит снаружи, поэтому в лог попадает короткая строка из безопасных
 * символов: иначе любой желающий мог бы засорить лог или подделать в нём строку
 * переводами строк. Формат клиента — `ios/1.2.0+34`, под него и допуск.
 */
export function clientVersionFrom(request: FastifyRequest): string | undefined {
  // `headers?.` намеренно: эта функция вызывается из фильтра исключений, и падение
  // в ней подменило бы исходную ошибку своей.
  const header = request.headers?.['x-client-version']
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) {
    return undefined
  }
  const safe = raw.replace(/[^\w.+/-]/g, '').slice(0, MAX_LENGTH)
  return safe.length > 0 ? safe : undefined
}
