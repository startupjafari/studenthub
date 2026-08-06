'use client'

import { useId } from 'react'
import { cn } from '../lib/utils'

export type FlagCode = 'ru' | 'kk' | 'en'

// Инлайн-SVG флаги: emoji-флаги на Windows не отображаются (Chrome рисует буквенный код),
// поэтому рисуем векторно — одинаково во всех ОС. Скруглённый прямоугольник ~4:3.
export function Flag({ code, className }: { code: FlagCode; className?: string }) {
  const uid = useId()
  const cls = cn('inline-block h-3.5 w-5 shrink-0 rounded-[3px] ring-1 ring-black/10', className)

  if (code === 'ru') {
    return (
      <svg viewBox="0 0 24 18" className={cls} aria-hidden preserveAspectRatio="none">
        <rect width="24" height="6" y="0" fill="#ffffff" />
        <rect width="24" height="6" y="6" fill="#0039a6" />
        <rect width="24" height="6" y="12" fill="#d52b1e" />
      </svg>
    )
  }

  if (code === 'kk') {
    return (
      <svg viewBox="0 0 24 18" className={cls} aria-hidden preserveAspectRatio="none">
        <rect width="24" height="18" fill="#00afca" />
        <circle cx="12" cy="8.5" r="3.1" fill="#fec50c" />
        <g stroke="#fec50c" strokeWidth="0.6">
          <line x1="12" y1="3.6" x2="12" y2="4.7" />
          <line x1="12" y1="12.3" x2="12" y2="13.4" />
          <line x1="7.1" y1="8.5" x2="8.2" y2="8.5" />
          <line x1="15.8" y1="8.5" x2="16.9" y2="8.5" />
        </g>
      </svg>
    )
  }

  // en → флаг Великобритании (Union Jack), компактная стандартная разметка.
  const s = `s-${uid}`
  const t = `t-${uid}`
  return (
    <svg viewBox="0 0 60 30" className={cls} aria-hidden preserveAspectRatio="none">
      <clipPath id={s}>
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id={t}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath={`url(#${s})`}>
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
        <path
          d="M0,0 L60,30 M60,0 L0,30"
          clipPath={`url(#${t})`}
          stroke="#c8102e"
          strokeWidth="4"
        />
        <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
      </g>
    </svg>
  )
}
