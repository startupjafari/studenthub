import { api } from '../api'

// Клиентская часть Web Push (Ф13.3): подписка/отписка через service worker + VAPID.
// Публичный ключ — из NEXT_PUBLIC_VAPID_PUBLIC_KEY (совпадает с VAPID_PUBLIC_KEY api).

function vapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null
}

/** Поддерживается ли Web Push в этом окружении. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// base64url VAPID-ключ → Uint8Array для applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/**
 * Подписать браузер на push. Возвращает true при успехе. Требует разрешения на уведомления
 * (запрашивается здесь по жесту) и настроенного VAPID-ключа + зарегистрированного SW.
 */
export async function subscribeToPush(): Promise<boolean> {
  const key = vapidPublicKey()
  if (!pushSupported() || !key) return false
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    })
  }
  const json = sub.toJSON()
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys })
  return true
}

/** Отписать браузер: снимаем подписку у push-сервиса и удаляем её на бэкенде. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}
