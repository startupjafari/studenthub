import type { Locale } from '../config/site'

/**
 * Флажки языков — свои SVG, а не эмодзи.
 *
 * Эмодзи-флаги не рисуются на Windows вовсе: система показывает вместо них буквенный код,
 * и в меню получается «KZ Қазақша». Библиотеку флагов (в платформе это `flag-icons`)
 * тянуть ради трёх значков незачем — здесь нужны ровно три, и они помещаются в дюжину
 * строк разметки.
 *
 * Пропорции 3:2, форма упрощена до узнаваемого минимума: на 16 пикселях детали всё равно
 * не читаются.
 */
export function Flag({ locale, className = '' }: { locale: Locale; className?: string }) {
  const common = `shrink-0 rounded-[2px] ${className}`

  if (locale === 'kk') {
    return (
      <svg viewBox="0 0 30 20" className={common} aria-hidden focusable="false">
        <rect width="30" height="20" fill="#00AFCA" />
        <circle cx="15" cy="9" r="4" fill="#FEC50C" />
        <path d="M9 15h12" stroke="#FEC50C" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }

  if (locale === 'en') {
    return (
      <svg viewBox="0 0 30 20" className={common} aria-hidden focusable="false">
        <rect width="30" height="20" fill="#012169" />
        <path d="M0 0l30 20M30 0L0 20" stroke="#fff" strokeWidth="4" />
        <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6" />
        <path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="3.5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 30 20" className={common} aria-hidden focusable="false">
      <rect width="30" height="20" fill="#fff" />
      <rect y="6.67" width="30" height="6.66" fill="#0039A6" />
      <rect y="13.33" width="30" height="6.67" fill="#D52B1E" />
    </svg>
  )
}
