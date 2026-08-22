import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useInView } from './use-in-view'

// Ленивое монтирование — основная оптимизация дашборда: восемь полотен chart.js
// и восемь запросов при открытии страницы не нужны, видно от них один-два.

function Probe() {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div ref={ref} data-testid="probe">
      {inView ? 'виден' : 'скрыт'}
    </div>
  )
}

type Cb = (entries: { isIntersecting: boolean }[]) => void

describe('useInView', () => {
  const originalIO = globalThis.IntersectionObserver

  afterEach(() => {
    globalThis.IntersectionObserver = originalIO
    vi.restoreAllMocks()
  })

  describe('когда IntersectionObserver есть', () => {
    let trigger: Cb | null = null
    const disconnect = vi.fn()

    beforeEach(() => {
      trigger = null
      disconnect.mockClear()
      class FakeIO {
        constructor(cb: Cb) {
          trigger = cb
        }
        observe = vi.fn()
        disconnect = disconnect
        unobserve = vi.fn()
        takeRecords = vi.fn()
        root = null
        rootMargin = ''
        thresholds = []
      }
      globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver
    })

    it('до пересечения элемент считается скрытым', () => {
      render(<Probe />)
      expect(screen.getByTestId('probe')).toHaveTextContent('скрыт')
    })

    it('после пересечения становится видимым и наблюдение прекращается', () => {
      render(<Probe />)
      act(() => trigger?.([{ isIntersecting: true }]))
      expect(screen.getByTestId('probe')).toHaveTextContent('виден')
      // Флаг залипающий: наблюдать дальше не нужно, иначе прокрутка вверх-вниз
      // пересоздавала бы полотно и перезапрашивала данные.
      expect(disconnect).toHaveBeenCalled()
    })

    it('запись без пересечения ничего не меняет', () => {
      render(<Probe />)
      act(() => trigger?.([{ isIntersecting: false }]))
      expect(screen.getByTestId('probe')).toHaveTextContent('скрыт')
    })
  })

  it('без IntersectionObserver показывает сразу', () => {
    // @ts-expect-error — намеренно убираем API, проверяем запасной путь.
    delete globalThis.IntersectionObserver
    render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('виден')
  })
})
