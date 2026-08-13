import { describe, expect, it } from 'vitest'
import { pickLocale } from './localize'

const obj = { nameRu: 'Справка', nameKk: 'Анықтама', nameEn: 'Certificate' }

describe('pickLocale', () => {
  it('берёт поле по активной локали', () => {
    expect(pickLocale(obj, 'name', 'ru')).toBe('Справка')
    expect(pickLocale(obj, 'name', 'kk')).toBe('Анықтама')
    expect(pickLocale(obj, 'name', 'en')).toBe('Certificate')
  })

  it('неизвестная локаль → русский фолбэк', () => {
    expect(pickLocale(obj, 'name', 'fr')).toBe('Справка')
  })

  it('пустое локализованное значение → русский фолбэк', () => {
    expect(pickLocale({ nameRu: 'Справка', nameKk: null, nameEn: null }, 'name', 'en')).toBe(
      'Справка',
    )
  })

  it('нет ни одного варианта → пустая строка', () => {
    expect(pickLocale({}, 'name', 'ru')).toBe('')
  })

  it('работает с произвольным base', () => {
    expect(pickLocale({ descRu: 'Описание', descEn: 'Desc' }, 'desc', 'en')).toBe('Desc')
  })
})
