'use client'

import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react'

/**
 * Клавиатура для выпадающего списка с полем поиска: ↑/↓ ведут по строкам, Enter выбирает
 * подсвеченную, Home/End прыгают к краям, Escape закрывает.
 *
 * Зачем хук, а не три копии. `DictSingleSelect`, `DictMultiSelect` и `AsyncSelect`
 * устроены одинаково — поле ввода и список под ним, — и во всех трёх клавиатура работала
 * наполовину: Enter выбирал ПЕРВУЮ строку, а стрелки не делали ничего. То есть с
 * клавиатуры из списка доставалась ровно одна строка, до остальных нужна была мышь.
 *
 * Номер строки, а не её значение: строка «добавить своё» значением не описывается, но
 * ходить по ней стрелками надо наравне с остальными — она последняя в том же списке.
 */
export function useListboxKeys({
  count,
  onPick,
  onClose,
  resetKey,
}: {
  /** Сколько строк в списке сейчас — включая «добавить своё», если она показана. */
  count: number
  /** Выбрать строку с этим номером. */
  onPick: (index: number) => void
  /** Закрыть список (Escape). Нет — Escape не перехватывается. */
  onClose?: () => void
  /**
   * Что считать сменой набора строк. Обычно это строка запроса: по ней подсветка
   * возвращается на первую строку. По одному `count` этого не поймать — набор меняется
   * и при той же длине.
   */
  resetKey?: string
}): {
  /** Номер подсвеченной строки; −1, когда показывать нечего. */
  active: number
  setActive: (index: number) => void
  /** id строки — для `aria-activedescendant` и прокрутки к ней. */
  optionId: (index: number) => string
  activeId: string | undefined
  onKeyDown: (e: KeyboardEvent) => void
} {
  const baseId = useId()
  const [raw, setRaw] = useState(0)
  // Набор мог сократиться между рендерами (ввели букву) — подсветку зажимаем в границы
  // прямо при чтении, а не чиним эффектом: эффект отработает кадром позже, и этот кадр
  // Enter успеет выбрать строку, которой уже нет.
  const active = count > 0 ? Math.min(raw, count - 1) : -1

  useEffect(() => {
    setRaw(0)
  }, [resetKey])

  // Подсвеченная строка всегда в поле зрения: список прокручивается за выбором, а не
  // уезжает под край.
  useEffect(() => {
    if (active < 0) return
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, baseId])

  const onKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      // По краям список заворачивается: от последней строки ↓ ведёт к первой. Так ведёт
      // себя и нативный <select>, и выпадающие списки Radix в этом же продукте.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (count > 0) setRaw((i) => (Math.min(i, count - 1) + 1) % count)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (count > 0) setRaw((i) => (Math.min(i, count - 1) - 1 + count) % count)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setRaw(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        if (count > 0) setRaw(count - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (count > 0) onPick(count > 0 ? Math.min(raw, count - 1) : 0)
      } else if (e.key === 'Escape' && onClose) {
        e.preventDefault()
        onClose()
      }
    },
    [count, onPick, onClose, raw],
  )

  return {
    active,
    setActive: setRaw,
    optionId: (index: number) => `${baseId}-opt-${index}`,
    activeId: active >= 0 ? `${baseId}-opt-${active}` : undefined,
    onKeyDown,
  }
}
