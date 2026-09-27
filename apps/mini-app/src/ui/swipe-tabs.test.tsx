import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../telegram/webapp', () => ({
  haptic: {
    tap: vi.fn(),
    snap: vi.fn(),
    select: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

import { SwipeTabs } from './swipe-tabs'

// Листание разделов пальцем. Проверяем не анимацию, а решения: когда жест считается
// переключением, когда возвратом на место и когда его вообще нельзя перехватывать.
describe('SwipeTabs', () => {
  const IDS = ['complaints', 'support', 'people', 'control'] as const

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  })

  function setup(active: (typeof IDS)[number] = 'support') {
    const onSelect = vi.fn()
    render(
      <SwipeTabs ids={IDS} active={active} onSelect={onSelect}>
        <div data-testid="screen">
          <button type="button">строка</button>
          <div className="swipe">
            <button type="button">строка со своим свайпом</button>
          </div>
          <div className="tabs">
            <button type="button">вкладка внутри экрана</button>
          </div>
        </div>
      </SwipeTabs>,
    )
    const area = screen.getByTestId('screen').parentElement as HTMLElement
    area.setPointerCapture = vi.fn()
    return { area, onSelect }
  }

  /** Один жест: нажать, провести до нужного сдвига и отпустить. */
  function swipe(area: HTMLElement, target: Element, dx: number, dy = 0): void {
    const opts = { bubbles: true, pointerId: 1, pointerType: 'touch' }
    act(() => {
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 200, clientY: 300 }))
      // Два шага: первый снимает порог оси, второй доводит до нужного сдвига.
      area.dispatchEvent(
        new PointerEvent('pointermove', {
          ...opts,
          clientX: 200 + Math.sign(dx) * 20,
          clientY: 300 + dy,
        }),
      )
      area.dispatchEvent(
        new PointerEvent('pointermove', { ...opts, clientX: 200 + dx, clientY: 300 + dy }),
      )
      area.dispatchEvent(
        new PointerEvent('pointerup', { ...opts, clientX: 200 + dx, clientY: 300 }),
      )
    })
  }

  it('смахивание влево открывает следующий раздел', () => {
    const { area, onSelect } = setup('support')

    swipe(area, area, -120)

    expect(onSelect).toHaveBeenCalledWith('people')
  })

  it('смахивание вправо открывает предыдущий', () => {
    const { area, onSelect } = setup('support')

    swipe(area, area, 120)

    expect(onSelect).toHaveBeenCalledWith('complaints')
  })

  it('короткий сдвиг не переключает — содержимое встаёт на место', () => {
    const { area, onSelect } = setup('support')

    swipe(area, area, -40)

    expect(onSelect).not.toHaveBeenCalled()
    expect(area.style.transform).toBe('')
  })

  it('у крайнего раздела дальше не листает', () => {
    const { area, onSelect } = setup('complaints')

    swipe(area, area, 200)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('вертикальное движение остаётся прокруткой', () => {
    const { area, onSelect } = setup('support')

    swipe(area, area, -30, 120)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('не перехватывает жест у строки с собственным свайпом', () => {
    const { area, onSelect } = setup('support')

    swipe(area, screen.getByText('строка со своим свайпом'), -120)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('не перехватывает жест у ряда вкладок, который прокручивается сам', () => {
    const { area, onSelect } = setup('support')

    swipe(area, screen.getByText('вкладка внутри экрана'), -120)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('мышью не листает: на десктопе для этого есть панель разделов', () => {
    const { area, onSelect } = setup('support')
    const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse' }
    act(() => {
      area.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: 200, clientY: 300 }))
      area.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: 60, clientY: 300 }))
      area.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: 60, clientY: 300 }))
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('клик после жеста не проходит: человек листал, а не нажимал', () => {
    const { area } = setup('support')
    const row = screen.getByText('строка')
    const onClick = vi.fn()
    row.addEventListener('click', onClick)

    swipe(area, area, -120)
    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onClick).not.toHaveBeenCalled()
  })
})
