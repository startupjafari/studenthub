'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Перестановка строк списка чатов — как в Telegram: пришло сообщение, чат поднялся наверх, а
 * остальные строки плавно съехали на его место, а не перескочили кадром.
 *
 * Приём FLIP: после рендера меряем, где строка оказалась, и сдвигаем её трансформом туда, где
 * она была, а следующим кадром отпускаем к нулю переходом. Раскладку анимация не трогает —
 * только `transform` и `opacity` (DESIGN_SYSTEM §7).
 *
 * Как и в Telegram, через весь список строка не летит: строки, ушедшие «против большинства»
 * (чат с сороковой позиции на первую, пока остальные сдвинулись на одну вниз), появляются на
 * новом месте растворением, а едут только те, что сдвинулись вместе со всеми. Иначе одна
 * строка пролетала бы поверх десятков других.
 *
 * Это декоративное движение, а не жест: длительность — токен `--motion-page`, кривая —
 * `--motion-ease`. При `prefers-reduced-motion` строки встают на место сразу.
 *
 * `resetKey` — смена набора (другая папка, архив, поиск): строки не переставились, а сменился
 * весь список, ехать им неоткуда.
 */
export function useListReorder(ids: readonly string[], resetKey: string) {
  const elsRef = useRef(new Map<string, HTMLElement>())
  const topsRef = useRef(new Map<string, number>())
  const keyRef = useRef(resetKey)
  const idsSig = ids.join('|')

  const register = useCallback(
    (id: string) =>
      (el: HTMLElement | null): void => {
        if (el) elsRef.current.set(id, el)
        else elsRef.current.delete(id)
      },
    [],
  )

  useLayoutEffect(() => {
    const els = elsRef.current
    const prevTops = topsRef.current
    const nextTops = new Map<string, number>()
    const keyChanged = keyRef.current !== resetKey
    keyRef.current = resetKey

    // Список скрыт (на телефоне открыт чат): у скрытых строк нулевые координаты, сравнивать
    // с ними нельзя — следующий показ «уехал» бы всеми строками сверху.
    const anyEl = els.values().next().value as HTMLElement | undefined
    if (!anyEl || anyEl.offsetParent === null) {
      topsRef.current = nextTops
      return
    }
    for (const [id, el] of els) nextTops.set(id, el.offsetTop)
    topsRef.current = nextTops

    if (keyChanged || prevTops.size === 0) return
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    // fresh — строки, которой прежде не было (новый чат): она проявляется на своём месте.
    const moves: { el: HTMLElement; delta: number; fresh: boolean }[] = []
    let up = 0
    let down = 0
    for (const [id, el] of els) {
      const before = prevTops.get(id)
      const after = nextTops.get(id)
      if (after === undefined) continue
      if (before === undefined) {
        moves.push({ el, delta: 0, fresh: true })
        continue
      }
      if (before === after) continue
      const delta = before - after
      if (delta > 0) up += 1
      else down += 1
      moves.push({ el, delta, fresh: false })
    }
    if (moves.length === 0) return

    // Строка ещё едет с прошлой перестановки: старт — с её экранного положения (вычисленный
    // трансформ посреди перехода), а не с логического, иначе на втором сообщении подряд она
    // дёрнулась бы.
    const shifts = moves.map(({ el }) => {
      const t = getComputedStyle(el).transform
      return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0
    })

    // Первый шаг — без перехода: строку ставим туда, где её видели.
    moves.forEach(({ el, delta, fresh }, i) => {
      // Поднялась вверх (delta > 0), когда большинство съехало вниз, — или наоборот.
      const against = fresh || (delta > 0 && up <= down) || (delta < 0 && down < up)
      el.style.transition = 'none'
      el.style.transform = against ? '' : `translateY(${delta + (shifts[i] ?? 0)}px)`
      el.style.opacity = against ? '0' : ''
    })
    // Принудительный пересчёт стилей: без него браузер склеил бы оба шага в один кадр, и
    // перехода бы не было.
    void moves[0]?.el.getBoundingClientRect()
    // Второй шаг — отпускаем к месту переходом.
    for (const { el } of moves) {
      el.style.transition =
        'transform var(--motion-page) var(--motion-ease), opacity var(--motion-page) var(--motion-ease)'
      el.style.transform = ''
      el.style.opacity = ''
      const done = (e: TransitionEvent): void => {
        if (e.target !== el) return
        el.style.transition = ''
        el.removeEventListener('transitionend', done)
      }
      el.addEventListener('transitionend', done)
    }
    // idsSig — порядок строк: эффект нужен ровно тогда, когда он сменился.
  }, [idsSig, resetKey])

  return register
}
