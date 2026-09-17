import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safe-next'

// Параметр `next` приходит из ссылки, которую можно прислать кому угодно: всё, что после
// проверки попадает в router.replace, обязано остаться на нашем origin.
describe('safeNextPath', () => {
  it('пропускает относительный путь с query', () => {
    expect(safeNextPath('/rooms/42')).toBe('/rooms/42')
    expect(safeNextPath('/schedule?week=2')).toBe('/schedule?week=2')
  })

  it('отбрасывает пустое значение и абсолютный URL', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath('')).toBeNull()
    expect(safeNextPath('https://evil.com')).toBeNull()
    expect(safeNextPath('evil.com')).toBeNull()
  })

  it('отбрасывает протокол-относительный адрес', () => {
    expect(safeNextPath('//evil.com')).toBeNull()
  })

  // Разбор URL по WHATWG считает `\` эквивалентом `/` в схемах http(s):
  // new URL('/\\evil.com', origin) === 'https://evil.com/'.
  it('отбрасывает обратный слэш — он равен прямому при разборе URL', () => {
    expect(safeNextPath('/\\evil.com')).toBeNull()
    expect(safeNextPath('/\\/evil.com')).toBeNull()
    expect(safeNextPath('/rooms/\\evil.com')).toBeNull()
    // Контроль: именно эту строку прежняя проверка пропускала.
    expect(new URL('/\\evil.com', 'https://app.local').origin).toBe('https://evil.com')
  })

  it('отбрасывает управляющие символы — разборщик URL вырезает их молча', () => {
    expect(safeNextPath('/\tevil')).toBeNull()
    expect(safeNextPath('/\nevil')).toBeNull()
    expect(safeNextPath('/\r\n//evil.com')).toBeNull()
  })
})
