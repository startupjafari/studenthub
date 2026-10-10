import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useListboxKeys } from './use-listbox-keys'

// Событие клавиатуры подделываем минимально: хуку нужны только `key` и `preventDefault`.
function key(k: string) {
  const prevented = vi.fn()
  return { event: { key: k, preventDefault: prevented } as never, prevented }
}

function setup(count: number, resetKey?: string) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const hook = renderHook(
    ({ c, r }: { c: number; r?: string }) =>
      useListboxKeys({ count: c, onPick, onClose, resetKey: r }),
    { initialProps: { c: count, r: resetKey } },
  )
  const press = (k: string): void => {
    act(() => hook.result.current.onKeyDown(key(k).event))
  }
  return { ...hook, onPick, onClose, press }
}

describe('useListboxKeys', () => {
  it('начинает с первой строки', () => {
    const { result } = setup(3)
    expect(result.current.active).toBe(0)
  })

  it('стрелки ведут по списку', () => {
    const { result, press } = setup(3)
    press('ArrowDown')
    expect(result.current.active).toBe(1)
    press('ArrowDown')
    expect(result.current.active).toBe(2)
    press('ArrowUp')
    expect(result.current.active).toBe(1)
  })

  it('список заворачивается по краям', () => {
    const { result, press } = setup(3)
    press('ArrowUp')
    expect(result.current.active).toBe(2)
    press('ArrowDown')
    expect(result.current.active).toBe(0)
  })

  it('Home и End прыгают к краям', () => {
    const { result, press } = setup(5)
    press('End')
    expect(result.current.active).toBe(4)
    press('Home')
    expect(result.current.active).toBe(0)
  })

  it('Enter выбирает подсвеченную строку, а не первую', () => {
    const { onPick, press } = setup(3)
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect(onPick).toHaveBeenCalledWith(2)
  })

  it('Escape закрывает', () => {
    const { onClose, press } = setup(3)
    press('Escape')
    expect(onClose).toHaveBeenCalled()
  })

  it('пустой список не выбирает и не падает', () => {
    const { result, onPick, press } = setup(0)
    expect(result.current.active).toBe(-1)
    press('ArrowDown')
    press('Enter')
    expect(onPick).not.toHaveBeenCalled()
  })

  // Главное ради чего клампим: набор сокращается на вводе буквы, и подсветка не должна
  // указывать на строку, которой уже нет, — иначе Enter выберет пустоту.
  it('подсветка зажимается в границы при сокращении списка', () => {
    const { result, rerender, onPick, press } = setup(5)
    press('End')
    expect(result.current.active).toBe(4)
    rerender({ c: 2, r: undefined })
    expect(result.current.active).toBe(1)
    press('Enter')
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('смена запроса возвращает подсветку на первую строку', () => {
    const { result, rerender, press } = setup(5, 'а')
    press('End')
    expect(result.current.active).toBe(4)
    rerender({ c: 5, r: 'аб' })
    expect(result.current.active).toBe(0)
  })

  it('гасит прокрутку страницы стрелками', () => {
    const { result } = setup(3)
    const k = key('ArrowDown')
    act(() => result.current.onKeyDown(k.event))
    expect(k.prevented).toHaveBeenCalled()
  })
})
