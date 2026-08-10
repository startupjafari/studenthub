'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { Role } from '@studenthub/shared-types'
import { cn } from '../../../shared/lib/utils'
import { computeProfileCompletion } from './completion'
import { ENTER } from './profile-content'

// Минималистичная плашка «Заполненность профиля»: строка (заголовок + процент) и тонкий
// прогресс-бар. Вся плашка — кнопка, ведёт в режим редактирования. Скрыта при 100%.
export function ProfileCompletion({
  data,
  role,
  onEdit,
}: {
  data: Record<string, unknown>
  role: Role
  onEdit: () => void
}) {
  const t = useTranslations('Profile')
  const percent = useMemo(() => computeProfileCompletion(data, role).percent, [data, role])

  if (percent >= 100) return null

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${t('completionTitle')} — ${percent}%`}
      className={cn(
        'group w-full rounded-xl border border-border bg-card px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30',
        ENTER,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t('completionTitle')}</span>
        <span className="text-sm font-semibold text-primary tabular-nums">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </button>
  )
}
