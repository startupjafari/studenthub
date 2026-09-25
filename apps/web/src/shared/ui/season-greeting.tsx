'use client'

import { useTranslations } from 'next-intl'
import { Sparkles, X } from 'lucide-react'
import { useSeasonGreeting } from '../lib/season'
import { cn } from '../lib/utils'

/**
 * Поздравление с праздником — одна строка на главной роли (shared/config/holidays.ts).
 *
 * Своего цвета у неё нет: `bg-primary/10 text-primary` (§2.2) сам становится праздничным,
 * потому что сезон переопределяет `--primary`. В сдержанные дни (Рождество, 9 мая,
 * Курбан айт) палитра не меняется и иконки нет — остаётся ровно строка текста.
 *
 * Закрывается и больше в этот праздник не показывается: поздравление, которое нельзя
 * убрать, за три дня Наурыза успевает стать раздражителем.
 */
export function SeasonGreeting({ className }: { className?: string }) {
  const t = useTranslations('Season')
  const tCommon = useTranslations('Common')
  const { season, dismiss } = useSeasonGreeting()

  if (!season) return null

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary',
        className,
      )}
    >
      {season.tone !== 'solemn' && <Sparkles className="size-4 shrink-0" aria-hidden />}
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
  )
}
