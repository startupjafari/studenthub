'use client'

import { useTranslations } from 'next-intl'
import { cn } from '../../../shared/lib'
import { cycleVoiceRate, useVoiceRate } from '../lib/voice-rate'

/**
 * Скорость голосового — справа от играющей записи, по нажатию 1× → 1,5× → 2×. Выбор
 * запоминается и действует на следующие голосовые (lib/voice-rate).
 */
export function VoiceRateButton({
  tone = 'default',
  className,
}: {
  tone?: 'default' | 'onPrimary'
  className?: string
}) {
  const t = useTranslations('Chats')
  const rate = useVoiceRate()
  const label = `${String(rate).replace('.', ',')}×`
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        cycleVoiceRate()
      }}
      aria-label={`${t('playbackSpeed')}: ${label}`}
      title={t('playbackSpeed')}
      className={cn(
        'h-6 min-w-10 shrink-0 rounded-full px-2 text-xs font-semibold tabular-nums transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
        tone === 'onPrimary'
          ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30'
          : 'bg-primary/10 text-primary hover:bg-primary/20',
        className,
      )}
    >
      {label}
    </button>
  )
}
