'use client'

import { cn } from '../lib/utils'
import { Flag } from './flag'
import type { LanguageFlagCode } from '../config/dictionaries'

// Флаг языка для справочника. ru/en/kk — из общего Flag; остальные — простые векторные
// флаги (полосы + пара спец-случаев), одинаковые во всех ОС (emoji-флаги на Windows не рисуются).

const CLS = 'inline-block h-3.5 w-5 shrink-0 rounded-[3px] ring-1 ring-black/10'

// Горизонтальные / вертикальные полосы (viewBox 24×18).
const STRIPES: Partial<Record<LanguageFlagCode, { dir: 'h' | 'v'; colors: string[] }>> = {
  es: { dir: 'h', colors: ['#c60b1e', '#ffc400', '#c60b1e'] },
  de: { dir: 'h', colors: ['#000000', '#dd0000', '#ffce00'] },
  uk: { dir: 'h', colors: ['#0057b7', '#ffd700'] },
  fr: { dir: 'v', colors: ['#0055a4', '#ffffff', '#ef4135'] },
  it: { dir: 'v', colors: ['#009246', '#ffffff', '#ce2b37'] },
  pt: { dir: 'v', colors: ['#006600', '#ff0000'] },
}

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = []
  for (let i = 0; i < 5; i++) {
    const ao = (-90 + i * 72) * (Math.PI / 180)
    const ai = (-90 + i * 72 + 36) * (Math.PI / 180)
    pts.push(`${cx + outer * Math.cos(ao)},${cy + outer * Math.sin(ao)}`)
    pts.push(`${cx + inner * Math.cos(ai)},${cy + inner * Math.sin(ai)}`)
  }
  return pts.join(' ')
}

export function LanguageFlag({ code, className }: { code: LanguageFlagCode; className?: string }) {
  if (code === 'ru' || code === 'en' || code === 'kk') {
    return <Flag code={code} className={className} />
  }

  const cls = cn(CLS, className)
  const stripes = STRIPES[code]
  if (stripes) {
    const n = stripes.colors.length
    return (
      <svg viewBox="0 0 24 18" className={cls} aria-hidden preserveAspectRatio="none">
        {stripes.colors.map((c, i) =>
          stripes.dir === 'h' ? (
            <rect key={i} x="0" y={(18 / n) * i} width="24" height={18 / n} fill={c} />
          ) : (
            <rect key={i} x={(24 / n) * i} y="0" width={24 / n} height="18" fill={c} />
          ),
        )}
      </svg>
    )
  }

  if (code === 'ja') {
    return (
      <svg viewBox="0 0 24 18" className={cls} aria-hidden preserveAspectRatio="none">
        <rect width="24" height="18" fill="#ffffff" />
        <circle cx="12" cy="9" r="4.6" fill="#bc002d" />
      </svg>
    )
  }

  if (code === 'zh') {
    return (
      <svg viewBox="0 0 24 18" className={cls} aria-hidden preserveAspectRatio="none">
        <rect width="24" height="18" fill="#de2910" />
        <polygon points={starPoints(6, 6, 3, 1.25)} fill="#ffde00" />
      </svg>
    )
  }

  // tr → красное поле, белый полумесяц и звезда.
  return (
    <svg viewBox="0 0 24 18" className={cls} aria-hidden preserveAspectRatio="none">
      <rect width="24" height="18" fill="#e30a17" />
      <circle cx="9" cy="9" r="3.6" fill="#ffffff" />
      <circle cx="10.2" cy="9" r="2.8" fill="#e30a17" />
      <polygon points={starPoints(13.6, 9, 1.7, 0.75)} fill="#ffffff" />
    </svg>
  )
}
