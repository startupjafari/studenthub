import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetLocale } from '../i18n'

// Язык резолвится один раз на модуль — между тестами его нужно сбрасывать, иначе
// первый же тест с казахской локалью «заражает» все следующие.
afterEach(() => {
  cleanup()
  resetLocale(null)
  delete (window as { Telegram?: unknown }).Telegram
})
