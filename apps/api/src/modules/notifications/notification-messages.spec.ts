import {
  NOTIFICATION_MESSAGES,
  NOTIFICATION_MESSAGE_KEYS,
  SUPPORTED_LOCALES,
  isNotificationMessageKey,
  renderNotificationMessage,
} from '@studenthub/shared-config'

// Словарь уведомлений общий для api и веба, и его легко сломать молча: статью добавили
// в русский каталог, про казахский и английский забыли — пользователь с kk получает
// пустое уведомление. Паритет здесь проверяется автоматически, потому что глазами
// пятьдесят с лишним строк на трёх языках не сверяются.

const PLACEHOLDERS = /\{(\w+)\}/g

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDERS)].map((m) => m[1] ?? '').sort()
}

describe('словарь уведомлений', () => {
  it('во всех языках одинаковый состав ключей', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(NOTIFICATION_MESSAGES[locale]).sort()).toEqual(
        [...NOTIFICATION_MESSAGE_KEYS].sort(),
      )
    }
  })

  it('ни одна статья не пустая', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of NOTIFICATION_MESSAGE_KEYS) {
        expect(NOTIFICATION_MESSAGES[locale][key].trim()).not.toBe('')
      }
    }
  })

  // Разошедшиеся подстановки — самая дорогая ошибка перевода: русская строка подставит
  // имя, казахская оставит пустое место, и заметит это только пользователь.
  it('подстановки совпадают во всех языках', () => {
    for (const key of NOTIFICATION_MESSAGE_KEYS) {
      const expected = placeholders(NOTIFICATION_MESSAGES.ru[key])
      for (const locale of SUPPORTED_LOCALES) {
        expect({ key, locale, ph: placeholders(NOTIFICATION_MESSAGES[locale][key]) }).toEqual({
          key,
          locale,
          ph: expected,
        })
      }
    }
  })

  it('подставляет параметры', () => {
    expect(renderNotificationMessage('ru', 'friends.request.body', { name: 'Иванов И.' })).toBe(
      'Иванов И. хочет добавить вас в друзья',
    )
    expect(renderNotificationMessage('en', 'applications.ready.body', { number: 'A-17' })).toBe(
      'Application A-17: the result is ready',
    )
  })

  // Ключ приходит из колонки базы: его мог записать код, где статья ещё была.
  it('неизвестный ключ даёт null, а не исключение', () => {
    expect(renderNotificationMessage('ru', 'нет.такой.статьи')).toBeNull()
    expect(isNotificationMessageKey('нет.такой.статьи')).toBe(false)
  })

  it('неизвестный язык откатывается на русский', () => {
    expect(renderNotificationMessage('de', 'applications.ready.title')).toBe('Документ готов')
  })

  // Лучше видимое `{change}`, чем пустое место: по пустому месту непонятно, что сломалось.
  it('пропущенный параметр остаётся видимым', () => {
    expect(renderNotificationMessage('ru', 'schedule.changed.body', { subject: 'Матанализ' })).toBe(
      'Матанализ: {change} на {date}',
    )
  })
})
