'use client'

import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  type Transition,
} from 'framer-motion'
import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

/**
 * Язык движения лендинга.
 *
 * Здесь и только здесь заданы кривая, пружина и длительности: секция, которая подбирает
 * свои, ломает ощущение одной страницы — блоки всплывают вразнобой, а подложка таба
 * едет не так, как точка на ленте времени.
 *
 * Почему обёртки, а не `motion.*` прямо в секциях: `'use client'` стоит на этом модуле,
 * а секции остаются серверными. Клиентский компонент принимает серверную разметку через
 * `children` — в бандл уезжает поведение, а не содержимое страницы. Если расставить
 * `'use client'` по секциям, на клиент поедет вся вёрстка вместе с текстами трёх языков.
 *
 * Framer Motion остался там, где без него не обойтись: переезд подложки (`layoutId`) и
 * смена содержимого с выходом (`AnimatePresence`). Появление блоков и отклик карточек
 * ушли на CSS-переходы — см. `Reveal` ниже и ui/press.tsx.
 */

/** Кривая выхода: быстрый старт, длинное успокоение. Одна на весь сайт. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** Пружина для переездов подложки (layoutId). Без овершута: это интерфейс, а не игра. */
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }

/** Смена содержимого внутри блока: короче появления, иначе таб «думает» после нажатия. */
export const SWAP: Transition = { duration: 0.28, ease: EASE }

/** Шаг каскада в группе, секунды. `delay` у Reveal — номер в очереди, а не время. */
const STEP = 0.07

/*
  Один наблюдатель на все блоки страницы.

  Framer Motion заводит наблюдение на каждый `whileInView` и ведёт появление сам, кадр за
  кадром, в основном потоке — там же, где браузер обрабатывает прокрутку. На слабом
  телефоне пять-шесть одновременно всплывающих карточек съедали кадры ровно в тот момент,
  когда палец двигает страницу. Теперь скрипт только ставит класс `.is-in`, а сам переход
  (opacity и transform, .sh-reveal в globals.css) браузер ведёт в потоке композитора.

  Граница срабатывания — нижние 12% окна, а не доля площади блока: блок выше экрана
  никогда не бывает виден на 15% целиком, и по доле он не проявился бы вовсе.
*/
let observer: IntersectionObserver | null = null

function watch(el: Element): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    el.classList.add('is-in')
    return () => {}
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        // Один раз: блок, который уплыл и приплыл обратно, не должен проявляться
        // заново — это выглядит как сбой, а не как приём.
        observer?.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  )
  observer.observe(el)
  return () => observer?.unobserve(el)
}

type RevealTag = 'div' | 'li' | 'section' | 'p'

export function Reveal({
  children,
  delay = 0,
  as = 'div',
  className = '',
  style,
}: {
  children: ReactNode
  /** Место в каскаде группы (0, 1, 2…), а не миллисекунды. */
  delay?: number
  as?: RevealTag
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    return el ? watch(el) : undefined
  }, [])

  return createElement(
    as,
    {
      ref,
      // Класс-метка нужна таблице стилей: блок скрыт до `.is-in`, а при
      // `prefers-reduced-motion` и без JavaScript показан сразу (globals.css, root-shell).
      className: `sh-reveal ${className}`,
      style: { ...style, '--d': `${delay * STEP}s` } as CSSProperties,
    },
    children,
  )
}

export { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll }
