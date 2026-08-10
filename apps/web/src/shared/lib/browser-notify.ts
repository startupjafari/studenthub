// Системные уведомления браузера (Web Notifications API) поверх существующего WS-события
// notification:new. Показываем только когда вкладка НЕ в фокусе — активную вкладку и так
// покрывает тост. Полноценный Web Push (service worker, офлайн-доставка) — задача Ф13.3.

/** Поддерживает ли окружение системные уведомления. */
function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Запросить разрешение (вызывать по жесту пользователя, напр. при открытии колокольчика). */
export async function ensureNotifyPermission(): Promise<void> {
  if (!supported()) return
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      /* пользователь мог заблокировать — молча игнорируем */
    }
  }
}

/**
 * Показать системное уведомление, если вкладка скрыта/не в фокусе и есть разрешение.
 * onClick — фокусирует окно (переход к контенту делает вызывающий код при желании).
 */
export function maybeNotify(title: string, body: string): void {
  if (!supported() || Notification.permission !== 'granted') return
  // Активную вкладку не трогаем — там тост.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
  try {
    const n = new Notification(title, { body })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* некоторые браузеры требуют SW для Notification — тогда просто пропускаем */
  }
}
