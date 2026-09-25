/**
 * Значки.
 *
 * Своими контурами, а не шрифтом значков и не пакетом: нужно их девять, а любая готовая
 * библиотека приносит сотни и весит больше всего остального приложения вместе взятого.
 *
 * Все рисуются линией в `currentColor` и наследуют цвет текста — значит, подсветка
 * активного раздела и приглушение неактивного делаются одним свойством, а не вторым
 * набором картинок. Размер по умолчанию 24: это сетка, на которой они нарисованы, и
 * дробное масштабирование размывает линии.
 */

import type { ReactNode } from 'react'

type IconProps = { size?: number }

function Svg({ size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** Жалобы: восклицательный знак в пузыре — сигнал, а не разговор. */
export function IconComplaints(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 12.3a7.7 7.7 0 0 1-8.2 7.7 8.6 8.6 0 0 1-2.7-.4L4 21l1.5-4.2a7.5 7.5 0 0 1-1-3.8A7.7 7.7 0 0 1 12.3 5a7.7 7.7 0 0 1 8.2 7.3Z" />
      <path d="M12.3 9.2v3.4" />
      <path d="M12.3 15.6h.01" />
    </Svg>
  )
}

/** Поддержка: два пузыря — здесь именно переписка. */
export function IconSupport(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 13.2a2 2 0 0 1-2 2H8.2L4.5 18v-9.8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2Z" />
      <path d="M17.5 9.5h.5a2 2 0 0 1 2 2V21l-3-2.5h-4a2 2 0 0 1-1.6-.8" />
    </Svg>
  )
}

/** Люди: человек и плечо второго — список, а не один профиль. */
export function IconPeople(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.6a3.4 3.4 0 0 1 0 6.3" />
      <path d="M18.4 14.2a6.2 6.2 0 0 1 2.6 4.6" />
    </Svg>
  )
}

/** Управление: ползунки — рычаги, которые двигают. */
export function IconControl(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.5h10" />
      <path d="M18 7.5h2" />
      <circle cx="16" cy="7.5" r="2" />
      <path d="M4 16.5h4" />
      <path d="M12 16.5h8" />
      <circle cx="10" cy="16.5" r="2" />
    </Svg>
  )
}

/** Назад: шеврон влево. Направление — единственное, что он обязан сообщить. */
export function IconBack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 5.5 8 12l7 6.5" />
    </Svg>
  )
}
