import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useCountUp } from './use-count-up'

// Счёт значения — декорация, поэтому проверяем ровно две вещи: что он доезжает
// до цели и что при prefers-reduced-motion его нет вовсе.

function Probe({ target, fractional }: { target: number; fractional?: boolean }) {
  const value = useCountUp(target, fractional)
  return <span data-testid="value">{value}</span>
}

/** Подменяем matchMedia: в jsdom его нет. */
function mockReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('useCountUp', () => {
  const rafs: FrameRequestCallback[] = []
  let clock = 0

  beforeEach(() => {
    rafs.length = 0
    clock = 0
    vi.stubGlobal('performance', { now: () => clock })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafs.push(cb)
      return rafs.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Проигрывает анимацию до конца. */
  function finish(): void {
    for (let i = 0; i < 60 && rafs.length > 0; i++) {
      const cb = rafs.shift()
      clock += 200
      act(() => cb?.(clock))
    }
  }

  it('стартует с нуля и доезжает до цели', () => {
    mockReducedMotion(false)
    render(<Probe target={396} />)
    expect(screen.getByTestId('value')).toHaveTextContent('0')
    finish()
    expect(screen.getByTestId('value')).toHaveTextContent('396')
  })

  it('дробное значение не округляется до целого', () => {
    mockReducedMotion(false)
    render(<Probe target={2.9} fractional />)
    finish()
    // Медиана разбора 2.9 ч не должна превратиться в 3.
    expect(screen.getByTestId('value')).toHaveTextContent('2.9')
  })

  it('при prefers-reduced-motion значение сразу финальное', () => {
    mockReducedMotion(true)
    render(<Probe target={396} />)
    expect(screen.getByTestId('value')).toHaveTextContent('396')
    // Кадры не запрашиваются вообще.
    expect(rafs).toHaveLength(0)
  })

  it('ноль остаётся нулём', () => {
    mockReducedMotion(false)
    render(<Probe target={0} />)
    finish()
    expect(screen.getByTestId('value')).toHaveTextContent('0')
  })
})
