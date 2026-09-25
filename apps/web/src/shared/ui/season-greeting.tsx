'use client'

import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { useSeasonGreeting } from '../lib/season'
import { cn } from '../lib/utils'
import { seasonIcon } from './season-icon'

// Частицы — отдельным чанком: включает их меньшинство, играют они несколько секунд в
// году, и в общий бандл главной им попадать незачем. ssr: false — эффект целиком
// клиентский (случайные координаты, таймер).
const SeasonDecor = dynamic(() => import('./season-decor').then((m) => m.SeasonDecor), {
  ssr: false,
})

/**
 * Поздравление с праздником — одна строка на главной роли (shared/config/holidays.ts).
 *
 * Своего цвета у неё нет: `bg-primary/10 text-primary` (§2.2) сам становится праздничным,
 * потому что сезон переопределяет `--primary`. В сдержанные дни (Рождество, 9 мая,
 * Курбан айт) палитра не меняется — остаётся знак дня и строка текста.
 *
 * Закрывается и больше в этот праздник не показывается: поздравление, которое нельзя
 * убрать, за три дня Наурыза успевает стать раздражителем.
 */
export function SeasonGreeting({ className }: { className?: string }) {
  const t = useTranslations('Season')
  const tCommon = useTranslations('Common')
  const { season, motion, dismiss } = useSeasonGreeting()

  if (!season) return null

  // Глиф свой у каждого праздника, слот — один и тот же: «этот день особенный».
  const Icon = seasonIcon(season.id)

  return (
    <>
      {motion && <SeasonDecor />}
      <div
        role="status"
        className={cn(
          'flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary',
          className,
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{t(`${season.id}.greeting`)}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={tCommon('close')}
          className="-mr-1 shrink-0 rounded-md p-1 text-primary/70 hover:bg-primary/15 hover:text-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </>
  )
}
