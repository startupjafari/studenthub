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

/**
 * Значок раздела бывает двух видов: контурный у невыбранного и залитый у выбранного.
 *
 * Так устроены значки во всех системных панелях iOS, и это не украшение: цвет отличает
 * выбранное, только пока его видно, — а на ярком солнце и в режиме высокой контрастности
 * различие цвета исчезает первым. Заливка остаётся.
 */
type TabIconProps = IconProps & { filled?: boolean }

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

/**
 * Залитый вариант: форма закрашивается, а внутренние знаки — не рисуются поверх, а
 * ВЫРЕЗАЮТСЯ из неё (`fill-rule: evenodd`). Нарисовать их поверх нечем: цвет фона под
 * значком задаёт Telegram, и угадывать его значило бы однажды промахнуться.
 */
function SvgFilled({ size = 24, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      stroke="none"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** Жалобы: восклицательный знак в пузыре — сигнал, а не разговор. */
export function IconComplaints({ filled, ...props }: TabIconProps) {
  if (filled) {
    return (
      <SvgFilled {...props}>
        <path d="M20.5 12.3a7.7 7.7 0 0 1-8.2 7.7 8.6 8.6 0 0 1-2.7-.4L4 21l1.5-4.2a7.5 7.5 0 0 1-1-3.8A7.7 7.7 0 0 1 12.3 5a7.7 7.7 0 0 1 8.2 7.3ZM11.5 8.6h1.6v4.6h-1.6V8.6Zm0 5.9h1.6v1.6h-1.6v-1.6Z" />
      </SvgFilled>
    )
  }
  return (
    <Svg {...props}>
      <path d="M20.5 12.3a7.7 7.7 0 0 1-8.2 7.7 8.6 8.6 0 0 1-2.7-.4L4 21l1.5-4.2a7.5 7.5 0 0 1-1-3.8A7.7 7.7 0 0 1 12.3 5a7.7 7.7 0 0 1 8.2 7.3Z" />
      <path d="M12.3 9.2v3.4" />
      <path d="M12.3 15.6h.01" />
    </Svg>
  )
}

/** Поддержка: два пузыря — здесь именно переписка. */
export function IconSupport({ filled, ...props }: TabIconProps) {
  if (filled) {
    return (
      <SvgFilled {...props}>
        <path d="M6.5 5.4h6a2.8 2.8 0 0 1 2.8 2.8v5a2.8 2.8 0 0 1-2.8 2.8H8.5L3.7 19.7V8.2a2.8 2.8 0 0 1 2.8-2.8Z" />
        <path d="M16.9 8.7h1.1a2.8 2.8 0 0 1 2.8 2.8v11.2l-.1-.1-3.5-2.9h-4a2.8 2.8 0 0 1-2.3-1.2h1.6a4.4 4.4 0 0 0 4.4-4.4V8.7Z" />
      </SvgFilled>
    )
  }
  return (
    <Svg {...props}>
      <path d="M14.5 13.2a2 2 0 0 1-2 2H8.2L4.5 18v-9.8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2Z" />
      <path d="M17.5 9.5h.5a2 2 0 0 1 2 2V21l-3-2.5h-4a2 2 0 0 1-1.6-.8" />
    </Svg>
  )
}

/** Люди: человек и плечо второго — список, а не один профиль. */
export function IconPeople({ filled, ...props }: TabIconProps) {
  if (filled) {
    return (
      <SvgFilled {...props}>
        <circle cx="10" cy="8.5" r="4.2" />
        <path d="M10 14.2c3.9 0 7.1 2.6 7.1 5.9 0 .5-.4.9-.9.9H3.8a.9.9 0 0 1-.9-.9c0-3.3 3.2-5.9 7.1-5.9Z" />
        <path d="M16.6 4.6a3.9 3.9 0 0 1 0 7.8 5.6 5.6 0 0 0 0-7.8Z" />
        <path d="M18.2 13.6c2.1.8 3.6 2.7 3.6 5 0 .5-.4.9-.9.9h-2.1c.1-.3.1-.6.1-.9 0-2-.7-3.7-1.9-5h1.2Z" />
      </SvgFilled>
    )
  }
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
export function IconControl({ filled, ...props }: TabIconProps) {
  if (filled) {
    return (
      <SvgFilled {...props}>
        <path d="M4 6.6h8.4a4 4 0 0 0 0 1.8H4a.9.9 0 0 1 0-1.8Zm15.6 0H20a.9.9 0 0 1 0 1.8h-.4a4 4 0 0 0 0-1.8Z" />
        <circle cx="16" cy="7.5" r="2.6" />
        <path d="M4 15.6h2.4a4 4 0 0 0 0 1.8H4a.9.9 0 0 1 0-1.8Zm9.6 0H20a.9.9 0 0 1 0 1.8h-6.4a4 4 0 0 0 0-1.8Z" />
        <circle cx="10" cy="16.5" r="2.6" />
      </SvgFilled>
    )
  }
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

/** Лупа в строке поиска: место ввода узнаётся по ней раньше, чем читается подсказка. */
export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 3.5 3.5" />
    </Svg>
  )
}

/** Шеврон строки: «здесь есть продолжение». */
export function IconChevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
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

/*
 * Значки разделов пульта. Рисуются белым внутри цветной плитки, поэтому линия чуть толще:
 * на заливке тонкий контур в размере 17 пикселей выцветает.
 */

/** Техработы: рубильник — то, чем гасят платформу. */
export function IconMaintenance(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5v7" strokeWidth="2" />
      <path d="M7.4 7.4a6.5 6.5 0 1 0 9.2 0" strokeWidth="2" />
    </Svg>
  )
}

/** Баннер: рупор — объявление всем сразу. */
export function IconBanner(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10v4h3l6 4V6l-6 4H4Z" strokeWidth="1.9" />
      <path d="M17 9.5a3.5 3.5 0 0 1 0 5" strokeWidth="1.9" />
    </Svg>
  )
}

/** Уведомления: колокольчик. */
export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5H6.5Z" strokeWidth="1.9" />
      <path d="M5 16.5h14" strokeWidth="1.9" />
      <path d="M10.2 19.2a2 2 0 0 0 3.6 0" strokeWidth="1.9" />
    </Svg>
  )
}

/** Разделы: сетка — то, из чего собрано приложение. */
export function IconSections(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.6" strokeWidth="1.9" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.6" strokeWidth="1.9" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.6" strokeWidth="1.9" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.6" strokeWidth="1.9" />
    </Svg>
  )
}

/** Оформление: искры — праздничный вид, а не функция. */
export function IconSeason(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M10 4.5 11.6 9l4.5 1.6-4.5 1.6L10 16.7 8.4 12.2 3.9 10.6 8.4 9 10 4.5Z"
        strokeWidth="1.8"
      />
      <path d="m17.5 14.5.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" strokeWidth="1.8" />
    </Svg>
  )
}

/** «Что нового»: флажок — отметка версии. */
export function IconRelease(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 20V5h9.5l-1.8 3.4L15.5 12H6" strokeWidth="1.9" />
    </Svg>
  )
}

/** Дежурство: человек с отметкой — кто сейчас на связи. */
export function IconDuty(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="8" r="3.4" strokeWidth="1.9" />
      <path d="M4.5 19.5a6 6 0 0 1 10.6-3.8" strokeWidth="1.9" />
      <path d="m15 18.2 1.9 1.9 3.6-3.9" strokeWidth="1.9" />
    </Svg>
  )
}

/** Размер текста: большая и малая буквы. */
export function IconTextSize({ size = 24 }: IconProps) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden
    >
      <text x="1.5" y="18.5" fontSize="15" fontWeight="600" fontFamily="inherit">
        A
      </text>
      <text x="12.5" y="18.5" fontSize="10" fontWeight="600" fontFamily="inherit">
        a
      </text>
    </svg>
  )
}

/** Откат: стрелка назад по дуге — «верни как было». */
export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 9.5h8a5 5 0 0 1 0 10h-6" strokeWidth="1.9" />
      <path d="m8.5 5.5-3.5 4 3.5 4" strokeWidth="1.9" />
    </Svg>
  )
}
