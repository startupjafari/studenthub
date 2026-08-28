/// <reference lib="webworker" />
// Кастомный код service worker (компилируется @ducanh2912/next-pwa и подключается в sw.js).
// Обрабатывает Web Push (Ф13.3): показ системного уведомления и переход по клику.
declare const self: ServiceWorkerGlobalScope

interface PushPayload {
  title?: string
  body?: string
  url?: string
}

// Команда от страницы «активируйся сейчас»: новый SW по умолчанию ждёт, пока закроются
// все вкладки со старым, а установленное приложение не закрывают неделями. Страница
// показывает тост «Доступна новая версия» и присылает это сообщение по нажатию.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {}
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    payload = { body: event.data?.text() }
  }
  const title = payload.title || 'StudentHub'
  const url = payload.url || '/'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        // Уже открытая вкладка приложения — фокусируем и ведём по ссылке.
        if ('focus' in client) {
          await client.navigate(url).catch(() => undefined)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})

export {}
