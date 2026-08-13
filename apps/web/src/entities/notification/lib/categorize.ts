import type { NotificationItem } from '../model/types'

// Продуктовые категории центра активности (docs/UNIFIED_UX.md PR-2). Тип уведомления
// грубоват (SYSTEM несёт много доменов), поэтому уточняем по префиксу data.url.
export type NotificationCategory = 'study' | 'deanery' | 'social' | 'system'

function urlOf(n: NotificationItem): string {
  return typeof n.data?.url === 'string' ? n.data.url : ''
}

const DEANERY_URL = /^\/(applications|documents|deanery|appointments)/
const STUDY_URL =
  /^\/(assignments|gradebook|exams|attendance|courses|schedule|study-plan|academic|materials)/
const SOCIAL_URL = /^\/(friends|chats|events|profile|feed|posts)/

export function notificationCategory(n: NotificationItem): NotificationCategory {
  switch (n.type) {
    case 'SCHEDULE_CHANGE':
      return 'study'
    case 'APP_UPDATE':
      return 'deanery'
    case 'MESSAGE':
    case 'POST':
    case 'EVENT':
      return 'social'
    default: {
      // SYSTEM и прочее — по адресу перехода.
      const url = urlOf(n)
      if (DEANERY_URL.test(url)) return 'deanery'
      if (STUDY_URL.test(url)) return 'study'
      if (SOCIAL_URL.test(url)) return 'social'
      return 'system'
    }
  }
}

// «Требует действия»: непрочитанные из доменов, где обычно нужна реакция студента
// (заявки/документы/задания/записи). Явный флаг data.actionRequired имеет приоритет.
const ACTIONABLE_URL = /^\/(applications|documents|assignments|appointments|deanery)/
export function isActionable(n: NotificationItem): boolean {
  if (typeof n.data?.actionRequired === 'boolean') return n.data.actionRequired
  return !n.isRead && ACTIONABLE_URL.test(urlOf(n))
}

// URL перехода уведомления (deep-link), если задан.
export function notificationUrl(n: NotificationItem): string | null {
  return urlOf(n) || null
}

// i18n-ключ подписи прямого действия (переиспользуем существующие open*-ключи Notifications).
export function notificationActionKey(n: NotificationItem): string {
  if (!urlOf(n)) return 'open'
  switch (n.type) {
    case 'MESSAGE':
      return 'openChat'
    case 'EVENT':
      return 'openEvent'
    case 'APP_UPDATE':
      return 'openApplication'
    default:
      return notificationCategory(n) === 'deanery' ? 'openApplication' : 'open'
  }
}
