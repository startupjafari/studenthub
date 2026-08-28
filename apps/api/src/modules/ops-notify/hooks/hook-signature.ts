import { createHmac, timingSafeEqual } from 'node:crypto'

// Проверка подлинности вебхуков (docs/TELEGRAM_BOT.md §5, §7.2.1).
//
// Эндпоинты публичные — внешние сервисы не умеют наш JWT, — поэтому вся защита здесь.
// Сравнение только `timingSafeEqual`: обычный `===` выходит на первом различающемся байте,
// и по времени ответа секрет подбирается посимвольно.

/**
 * Постоянное по времени сравнение строк.
 *
 * `timingSafeEqual` бросает на буферах разной длины, поэтому длину проверяем отдельно —
 * она и так утекает через размер заголовка, секретом не является.
 */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Штатная подпись GitHub: `sha256=<HMAC-SHA256 от СЫРОГО тела>`.
 *
 * Считать HMAC по пересобранному JSON нельзя: подпись покрывает точные байты, а
 * `JSON.stringify` разобранного объекта отличается порядком ключей и экранированием.
 * Поэтому контроллер работает с `rawBody`, а не с `body`.
 */
export function githubSignatureMatches(
  signature: string | undefined,
  secret: string,
  rawBody: Buffer | undefined,
): boolean {
  if (!signature || !secret || !rawBody) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  return secretMatches(signature, expected)
}
