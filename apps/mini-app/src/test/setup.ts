import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetLocale } from '../i18n'

// jsdom не реализует PointerEvent, а жесты (свайп разделов, свайп строк) написаны на
// указателях — без него их не проверить ничем, кроме мыши, то есть не проверить вовсе.
// Подменяем минимумом: React читает поля из нативного события, и MouseEvent с нужным
// типом и парой свойств для этого достаточно.
if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent = window.PointerEvent
}

// Захват указателя jsdom тоже не умеет: без заглушки любой жест падает на первом же
// движении, когда компонент просит удержать палец за краем элемента.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.hasPointerCapture = () => false
}

// Язык резолвится один раз на модуль — между тестами его нужно сбрасывать, иначе
// первый же тест с казахской локалью «заражает» все следующие.
afterEach(() => {
  cleanup()
  resetLocale(null)
  delete (window as { Telegram?: unknown }).Telegram
})
