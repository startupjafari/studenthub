import { describe, expect, it } from 'vitest'
import { notificationCategory, isActionable, notificationActionKey } from './categorize'
import type { NotificationItem, NotificationType } from '../model/types'

// Фикстура уведомления с минимумом полей (остальное не влияет на категоризацию).
function n(
  type: NotificationType,
  data: Record<string, unknown> | null = null,
  isRead = false,
): NotificationItem {
  return {
    id: 'n1',
    type,
    title: 't',
    body: 'b',
    data,
    isRead,
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('notificationCategory', () => {
  it('маппит типы на продуктовые категории', () => {
    expect(notificationCategory(n('SCHEDULE_CHANGE'))).toBe('study')
    expect(notificationCategory(n('APP_UPDATE'))).toBe('deanery')
    expect(notificationCategory(n('MESSAGE'))).toBe('social')
    expect(notificationCategory(n('POST'))).toBe('social')
    expect(notificationCategory(n('EVENT'))).toBe('social')
  })

  it('SYSTEM уточняет по префиксу data.url', () => {
    expect(notificationCategory(n('SYSTEM', { url: '/applications/1' }))).toBe('deanery')
    expect(notificationCategory(n('SYSTEM', { url: '/documents/5' }))).toBe('deanery')
    expect(notificationCategory(n('SYSTEM', { url: '/assignments/7' }))).toBe('study')
    expect(notificationCategory(n('SYSTEM', { url: '/gradebook' }))).toBe('study')
    expect(notificationCategory(n('SYSTEM', { url: '/friends' }))).toBe('social')
    expect(notificationCategory(n('SYSTEM', { url: '/chats/9' }))).toBe('social')
  })

  it('SYSTEM без url / с неизвестным url → system', () => {
    expect(notificationCategory(n('SYSTEM'))).toBe('system')
    expect(notificationCategory(n('SYSTEM', { url: '/settings' }))).toBe('system')
    expect(notificationCategory(n('SYSTEM', { foo: 'bar' }))).toBe('system')
  })
})

describe('isActionable', () => {
  it('явный флаг data.actionRequired имеет приоритет', () => {
    // true даже если прочитано
    expect(isActionable(n('SYSTEM', { actionRequired: true }, true))).toBe(true)
    // false даже если непрочитано + actionable-url
    expect(
      isActionable(n('SYSTEM', { actionRequired: false, url: '/applications/1' }, false)),
    ).toBe(false)
  })

  it('без флага: непрочитанное из actionable-домена → true', () => {
    expect(isActionable(n('APP_UPDATE', { url: '/applications/1' }, false))).toBe(true)
    expect(isActionable(n('SYSTEM', { url: '/documents/2' }, false))).toBe(true)
    expect(isActionable(n('SYSTEM', { url: '/appointments/3' }, false))).toBe(true)
  })

  it('без флага: прочитанное → false; не-actionable url → false', () => {
    expect(isActionable(n('APP_UPDATE', { url: '/applications/1' }, true))).toBe(false)
    expect(isActionable(n('EVENT', { url: '/events' }, false))).toBe(false)
    expect(isActionable(n('SYSTEM', null, false))).toBe(false)
  })
})

describe('notificationActionKey', () => {
  it('без url → open', () => {
    expect(notificationActionKey(n('APP_UPDATE', null))).toBe('open')
    expect(notificationActionKey(n('MESSAGE', { foo: 1 }))).toBe('open')
  })

  it('подбирает глагол по типу/категории', () => {
    expect(notificationActionKey(n('MESSAGE', { url: '/chats/1' }))).toBe('openChat')
    expect(notificationActionKey(n('EVENT', { url: '/events' }))).toBe('openEvent')
    expect(notificationActionKey(n('APP_UPDATE', { url: '/applications/1' }))).toBe(
      'openApplication',
    )
    // SYSTEM с deanery-url → openApplication
    expect(notificationActionKey(n('SYSTEM', { url: '/documents/2' }))).toBe('openApplication')
    // SYSTEM со study-url → open
    expect(notificationActionKey(n('SYSTEM', { url: '/assignments/3' }))).toBe('open')
  })
})
