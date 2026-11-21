import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { withStableCallbacks } from './with-stable-callbacks'

describe('withStableCallbacks', () => {
  it('не перерисовывает ребёнка, когда у родителя поменялись только обработчики', () => {
    const renders = vi.fn()
    const Child = ({ label, onPick }: { label: string; onPick: () => void }) => {
      renders()
      return <button onClick={onPick}>{label}</button>
    }
    const Stable = withStableCallbacks(Child)
    const picked: number[] = []
    let bump: () => void = () => {}
    function Parent() {
      const [n, setN] = useState(0)
      bump = () => setN((v) => v + 1)
      // Новая стрелка каждым рендером — как в JSX у ChatWindow.
      return <Stable label="ok" onPick={() => picked.push(n)} />
    }
    render(<Parent />)
    expect(renders).toHaveBeenCalledTimes(1)
    act(() => bump())
    act(() => bump())
    expect(renders).toHaveBeenCalledTimes(1)
    // Прокладка зовёт свежую версию: в замыкании последнее n, а не то, что было при монтировании.
    fireEvent.click(screen.getByRole('button'))
    expect(picked).toEqual([2])
  })

  it('перерисовывает при смене данных и отдаёт undefined, когда обработчика нет', () => {
    const seen: (string | boolean)[] = []
    const Child = ({ label, onPick }: { label: string; onPick?: () => void }) => {
      seen.push(label, typeof onPick === 'function')
      return null
    }
    const Stable = withStableCallbacks(Child)
    const { rerender } = render(<Stable label="a" onPick={() => {}} />)
    rerender(<Stable label="b" />)
    expect(seen).toEqual(['a', true, 'b', false])
  })
})
