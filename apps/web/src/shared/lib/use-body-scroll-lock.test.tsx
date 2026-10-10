import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBodyScrollLock } from './use-body-scroll-lock'

// jsdom не умеет scrollTo, а хук восстанавливает позицию при снятии блока.
window.scrollTo = vi.fn()

afterEach(() => {
  document.body.removeAttribute('style')
})

describe('useBodyScrollLock', () => {
  it('по умолчанию выделение не трогает: оттуда копируют текст', () => {
    const { unmount } = renderHook(() => useBodyScrollLock())
    expect(document.body.style.userSelect).toBe('')
    unmount()
  })

  // Ради чего правка: оверлей перетаскивают, и браузер выделяет текст ПОД ним —
  // в фоне синим подсвечивается вся страница.
  it('с lockSelection запрещает выделение на всей странице', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true, true))
    expect(document.body.style.userSelect).toBe('none')
    unmount()
    expect(document.body.style.userSelect).toBe('')
  })

  it('вложенные оверлеи не снимают запрет раньше времени', () => {
    const outer = renderHook(() => useBodyScrollLock(true, true))
    const inner = renderHook(() => useBodyScrollLock(true, true))
    expect(document.body.style.userSelect).toBe('none')

    inner.unmount()
    expect(document.body.style.userSelect).toBe('none')

    outer.unmount()
    expect(document.body.style.userSelect).toBe('')
  })

  // Прокрутка и выделение считаются отдельно: оверлей без запрета выделения не должен
  // снимать запрет, поставленный соседним.
  it('оверлей без запрета не снимает чужой', () => {
    const locking = renderHook(() => useBodyScrollLock(true, true))
    const plain = renderHook(() => useBodyScrollLock(true, false))
    expect(document.body.style.userSelect).toBe('none')

    plain.unmount()
    expect(document.body.style.userSelect).toBe('none')

    locking.unmount()
    expect(document.body.style.userSelect).toBe('')
  })

  it('прокрутка блокируется в обоих режимах', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true, true))
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.position).toBe('fixed')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
