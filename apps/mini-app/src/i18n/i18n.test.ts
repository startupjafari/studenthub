import { describe, expect, it, beforeEach } from 'vitest'
import { locale, resetLocale, t } from './index'

function telegramLanguage(code: string | undefined): void {
  ;(window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: { platform: 'android', initDataUnsafe: { user: { language_code: code } } },
  }
  resetLocale(null)
}

describe('выбор языка', () => {
  beforeEach(() => resetLocale(null))

  it('берёт язык из Telegram', () => {
    telegramLanguage('kk')
    expect(locale()).toBe('kk')
  })

  // Telegram присылает и «ru», и «ru-RU» — это один язык.
  it('понимает код с регионом', () => {
    telegramLanguage('en-GB')
    expect(locale()).toBe('en')
  })

  it('на незнакомом языке отдаёт русский, а не пустые строки', () => {
    telegramLanguage('de')
    expect(locale()).toBe('ru')
    expect(t('retry')).toBe('Повторить')
  })

  it('вне Telegram отдаёт русский', () => {
    resetLocale(null)
    expect(locale()).toBe('ru')
  })
})

describe('подстановки', () => {
  beforeEach(() => resetLocale('ru'))

  it('подставляет значения по имени', () => {
    expect(t('complaintsInQueue', { count: 12 })).toBe('12 в очереди')
  })

  // Порядок слов в трёх языках разный, поэтому подстановка именованная, а не по позиции.
  it('оставляет неизвестную подстановку как есть, а не роняет строку', () => {
    expect(t('complaintReporter', {})).toContain('{name}')
  })
})
