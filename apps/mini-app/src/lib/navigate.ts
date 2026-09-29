import { flushSync } from 'react-dom'

// Переходы между экранами.
//
// Экран в мини-аппе — состояние React, а не адрес, и без анимации переход выглядел как
// мгновенная подмена страницы: непонятно, провалился ли ты вглубь или вернулся. Как в
// навигации iOS, вглубь экран въезжает справа, назад — уезжает вправо, а смена вкладки —
// мягкое растворение: вкладки соседи, а не уровни.
//
// View Transitions API снимает кадр до и после и анимирует разницу сам — без обёрток над
// каждым экраном и без второй копии дерева в DOM. Нет API (старый WebView) или человек
// попросил меньше движения — переход мгновенный, как и раньше.

export type NavDirection = 'forward' | 'back' | 'fade'

type WithTransitions = Document & {
  startViewTransition?: (update: () => void) => unknown
}

export function navigate(update: () => void, direction: NavDirection = 'forward'): void {
  const doc = document as WithTransitions
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (!doc.startViewTransition || reduce) {
    update()
    return
  }
  // Направление — атрибутом на корне: по нему css выбирает, откуда въезжает новый кадр.
  document.documentElement.dataset.nav = direction
  // flushSync — чтобы снимок «после» сняли уже с новым экраном, а не с прежним.
  doc.startViewTransition(() => flushSync(update))
}
