'use client'

import { useEffect } from 'react'

/**
 * Высота экранной клавиатуры в CSS-переменной `--kb-inset`.
 *
 * На Android этим занимается сам браузер: `interactiveWidget: 'resizes-content'`
 * (layout.tsx) ужимает layout-viewport, и `100dvh` уже учитывает клавиатуру. Safari
 * на iOS этот параметр не поддерживает — там layout-viewport остаётся прежним, а
 * клавиатура просто накрывает нижнюю часть страницы. Оболочка приложения прибита
 * `fixed inset-0`, поэтому поле ввода чата оказывается ПОД клавиатурой, и набирать
 * приходится вслепую.
 *
 * Разница между layout- и visual-viewport и есть закрытая клавиатурой полоса. Оболочка
 * вычитает её из своей высоты (`h-[calc(100dvh-var(--kb-inset,0px))]`), и содержимое
 * поднимается над клавиатурой. Там, где браузер ужал viewport сам, разница равна нулю —
 * двойного сжатия не будет.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement

    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      // Пересчёт в кадре: iOS шлёт resize и scroll пачками во время анимации клавиатуры.
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))
        // Мелкие расхождения (адресная строка, дробные пиксели) за клавиатуру не считаем.
        root.style.setProperty('--kb-inset', inset > 24 ? `${Math.round(inset)}px` : '0px')
      })
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--kb-inset')
    }
  }, [])
}
