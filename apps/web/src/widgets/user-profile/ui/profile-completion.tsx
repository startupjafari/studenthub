'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import type { Role } from '@studenthub/shared-types'
import { Button, Card, CardContent } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { computeProfileCompletion } from './completion'
import { ENTER } from './profile-content'

const MAX_HINTS = 6

// Карточка «Заполненность профиля» — видна только владельцу и только пока профиль
// заполнен не полностью. Кнопка ведёт в режим редактирования.
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
  const result = useMemo(() => computeProfileCompletion(data, role), [data, role])

  if (result.percent >= 100) return null

  const hints = result.missing.slice(0, MAX_HINTS)
  const rest = result.missing.length - hints.length

  return (
    <Card className={cn('p-0', ENTER)}>
      <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold sm:text-base">{t('completionTitle')}</h2>
              <span className="shrink-0 text-lg font-bold text-primary tabular-nums sm:text-xl">
                {result.percent}%
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{t('completionHint')}</p>
          </div>
        </div>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={result.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('completionTitle')}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${result.percent}%` }}
          />
        </div>

        {hints.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">{t('completionMissing')}</span>
            <div className="flex flex-wrap gap-1.5">
              {hints.map((f) => (
                <span
                  key={f.key}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {t(f.labelKey)}
                </span>
              ))}
              {rest > 0 && (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {t('completionMore', { count: rest })}
                </span>
              )}
            </div>
          </div>
        )}

        <Button type="button" size="sm" onClick={onEdit} className="self-start">
          <Sparkles className="size-4" aria-hidden />
          {t('completionCta')}
        </Button>
      </CardContent>
    </Card>
  )
}
