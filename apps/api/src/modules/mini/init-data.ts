import { createHmac, timingSafeEqual } from 'node:crypto'

// Проверка подписи initData от Telegram Mini Apps.
//
// Единственное место, где решается, верить ли тому, что прислал клиент. Всё остальное в
// мини-аппе опирается на результат этой функции, поэтому она чистая (никаких запросов в
// БД и обращений к конфигу) и покрыта тестами: ошибку здесь не видно ни в логах, ни
// глазами — она проявится только тем, что кто-то войдёт под чужим аккаунтом.
//
// Алгоритм Telegram (https://core.telegram.org/bots/webapps):
//   1) из query-строки убрать `hash`, остальные пары отсортировать по ключу
//      и склеить как "k=v" через \n — это data-check-string;
//   2) секрет = HMAC-SHA256 от токена бота с КЛЮЧОМ "WebAppData" (именно в таком
//      порядке: ключ — константа, данные — токен, перепутать легко);
//   3) HMAC-SHA256 от data-check-string этим секретом === hash.
//
// Отдельно проверяется возраст `auth_date`. Без него подсмотренная один раз строка
// работала бы вечно: подпись-то верна. Окно намеренно узкое — мини-апп присылает
// свежую строку при каждом открытии, и растягивать окно незачем.

export interface InitDataUser {
  id: bigint
  firstName: string
  lastName?: string
  username?: string
}

export type InitDataResult =
  | { ok: true; user: InitDataUser; authDate: Date }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'no-user' }

/** Насколько старой может быть строка. Пять минут — запас на часы клиента и сеть. */
export const INIT_DATA_MAX_AGE_MS = 5 * 60_000

export function verifyInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
  maxAgeMs: number = INIT_DATA_MAX_AGE_MS,
): InitDataResult {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const hash = params.get('hash')
  if (!hash) return { ok: false, reason: 'malformed' }

  // Сортировка по ключу обязательна: Telegram считает подпись именно от отсортированного
  // списка, а порядок в присланной строке не гарантирован.
  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  // Сравнение постоянного времени: побайтовое сравнение строк утекает длину совпадения
  // и делает подбор подписи вопросом терпения.
  if (!equalsConstantTime(expected, hash)) return { ok: false, reason: 'signature' }

  const authDateRaw = Number(params.get('auth_date'))
  if (!Number.isFinite(authDateRaw) || authDateRaw <= 0) return { ok: false, reason: 'malformed' }
  const authDate = new Date(authDateRaw * 1000)
  // Строка из будущего — тоже отказ: это либо сбитые часы, либо попытка продлить срок.
  const age = now.getTime() - authDate.getTime()
  if (age > maxAgeMs || age < -maxAgeMs) return { ok: false, reason: 'expired' }

  const user = parseUser(params.get('user'))
  if (!user) return { ok: false, reason: 'no-user' }

  return { ok: true, user, authDate }
}

/**
 * `user` приезжает JSON-строкой внутри query-параметра. Читаем ровно те поля, что нужны:
 * идентификатор для привязки и имя с username — для показа.
 */
function parseUser(raw: string | null): InitDataUser | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { id, first_name, last_name, username } = parsed as Record<string, unknown>
    if (typeof id !== 'number' && typeof id !== 'string') return null
    if (typeof first_name !== 'string' || !first_name) return null
    return {
      // BigInt: идентификаторы Telegram уже выходят за пределы безопасного целого в JS.
      id: BigInt(id),
      firstName: first_name,
      ...(typeof last_name === 'string' ? { lastName: last_name } : {}),
      ...(typeof username === 'string' ? { username } : {}),
    }
  } catch {
    return null
  }
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
