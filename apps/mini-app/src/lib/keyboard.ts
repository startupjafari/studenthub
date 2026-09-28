import { useEffect } from 'react'

// Высота экранной клавиатуры в переменной `--kb-inset`.
//
// Экран переписки прибит к окну (`position: fixed` во весь экран), и без поправки на
// клавиатуру его нижний край остаётся под ней: поле ответа уезжает под клавиши, а
// подниматься ему некуда — прокручивается только лента реплик внутри.
//
// Поднять экран самому — единственный способ. Клавиатура не занимает места в разметке:
// на iOS layout-viewport при её появлении не меняется вовсе, она просто накрывает
// страницу сверху. Разница между layout-viewport (`window.innerHeight`) и видимой
// частью (`visualViewport`) и есть закрытая клавишами полоса.
//
// Тот же приём, что в вебе (apps/web, shared/lib/use-keyboard-inset.ts): там он появился
// ровно по этой причине — оболочка чата тоже прибита к окну.

/** Ниже этого считаем, что клавиатуры нет: дробные пиксели и панели браузера. */
const NOISE_PX = 24

export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement

    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      // Пересчёт в кадре: пока клавиатура выезжает, события resize и scroll идут пачками,
      // и считать полосу на каждое значило бы перерисовывать экран десятки раз за выезд.
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
        root.style.setProperty('--kb-inset', inset > NOISE_PX ? `${Math.round(inset)}px` : '0px')
      })
    }

    update()
    viewport.addEventListener('resize', update)
    // Скролл видимой части: iOS сдвигает её, подводя поле к клавиатуре, и без этого
    // события полоса считалась бы от старого положения.
    viewport.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--kb-inset')
    }
  }, [])
}
