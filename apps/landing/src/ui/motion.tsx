'use client'

import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  type Transition,
} from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'

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
 * Всё считается с `prefers-reduced-motion`: `initial={false}` отключает вход, а не
 * ускоряет его, — блок просто стоит на месте.
 */

/** Кривая выхода: быстрый старт, длинное успокоение. Одна на весь сайт. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** Пружина для переездов подложки (layoutId). Без овершута: это интерфейс, а не игра. */
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }

/** Смена содержимого внутри блока: короче появления, иначе таб «думает» после нажатия. */
export const SWAP: Transition = { duration: 0.28, ease: EASE }

/** Шаг каскада в группе. `delay` у Reveal — номер в очереди, а не миллисекунды. */
const STEP = 0.07

const TAGS = {
  div: motion.div,
  li: motion.li,
  section: motion.section,
  p: motion.p,
} as const

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
  as?: keyof typeof TAGS
  className?: string
  style?: CSSProperties
}) {
  const calm = useReducedMotion()
  /*
    Приведение к одному типу намеренное. Выборка из словаря даёт объединение
    `motion.div | motion.li | ...`, у которых типы пропсов различаются элементом, и TS на
    таком JSX выдаёт «union type that is too complex to represent». Пропсы, которые мы
    передаём (className, style, initial, whileInView, transition), есть у всех четырёх.
  */
  const Tag = TAGS[as] as typeof motion.div

  return (
    <Tag
      className={className}
      style={style}
      initial={calm ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      // Один раз: блок, который уплыл и приплыл обратно, не должен проявляться заново —
      // это выглядит как сбой, а не как приём.
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay: delay * STEP, ease: EASE }}
    >
      {children}
    </Tag>
  )
}

/**
 * Карточка, которая отзывается на курсор и на палец.
 *
 * Подъём — только там, где курсор есть: на тач-экране `whileHover` залипает после тапа,
 * и карточка остаётся приподнятой до следующего касания в другом месте.
 */
export function Lift({
  children,
  className = '',
  lift = -4,
}: {
  children: ReactNode
  className?: string
  lift?: number
}) {
  const calm = useReducedMotion()

  return (
    <motion.div
      className={className}
      whileTap={calm ? undefined : { scale: 0.985 }}
      whileHover={calm ? undefined : { y: lift }}
      transition={SPRING}
    >
      {children}
    </motion.div>
  )
}

/** Ссылка-кнопка с откликом на нажатие. Разметка та же, что у обычной `<a>`. */
export function TapLink({
  href,
  children,
  className = '',
  external = false,
  ariaLabel,
}: {
  href: string
  children: ReactNode
  className?: string
  external?: boolean
  ariaLabel?: string
}) {
  const calm = useReducedMotion()

  return (
    <motion.a
      href={href}
      aria-label={ariaLabel}
      // rel без noopener был бы дырой: страница-получатель получает window.opener.
      {...(external ? { rel: 'noopener' } : {})}
      className={className}
      whileTap={calm ? undefined : { scale: 0.97 }}
      transition={SPRING}
    >
      {children}
    </motion.a>
  )
}

export { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll }
