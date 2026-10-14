import { api } from '../api'

// Офлайн-кэши API в Service Worker (next.config.mjs → runtimeCaching): все кончаются на `-api`.
const API_CACHE_SUFFIX = '-api'
// Чей кэш лежит в браузере: при входе другого человека его надо стереть до первых запросов.
const OWNER_KEY = 'sh_cache_owner'
// Выход не должен ждать push-сервис или зависший SW дольше пары секунд.
const STEP_TIMEOUT_MS = 2000

/**
 * Стереть с устройства то, что принадлежит прошлому пользователю.
 *
 * Офлайн-кэш SW хранит ответы API по URL, без привязки к человеку: после выхода карта
 * студента, «Сегодня» и последние переписки лежали в Cache Storage до суток, а следующий
 * пользователь при медленной сети (NetworkFirst, таймаут 5 с) получал чужой ответ на тот
 * же URL. Push-подписка тоже переживала выход — уведомления с текстами сообщений
 * продолжали показываться на общем компьютере.
 *
 * Отписку шлём на сервер ДО выхода: после него запрос уже без токена.
 */
export async function forgetDeviceData(): Promise<void> {
  await Promise.allSettled([withTimeout(dropPushSubscription()), withTimeout(clearApiCaches())])
  writeOwner(null)
}

/** При входе: если кэш принадлежит другому человеку — стереть его. */
export async function claimDeviceCache(userId: string): Promise<void> {
  const owner = readOwner()
  if (owner !== null && owner !== userId) {
    await withTimeout(clearApiCaches()).catch(() => undefined)
  }
  writeOwner(userId)
}

async function dropPushSubscription(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // getRegistration, а не ready: без зарегистрированного SW `ready` не разрешается никогда.
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager?.getSubscription()
  if (!sub) return
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

async function clearApiCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  const names = await caches.keys()
  await Promise.all(names.filter((n) => n.endsWith(API_CACHE_SUFFIX)).map((n) => caches.delete(n)))
}

function withTimeout(p: Promise<void>): Promise<void> {
  return Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, STEP_TIMEOUT_MS))])
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // Приватный режим без хранилища: кэш тогда чистится только при выходе.
  }
}
