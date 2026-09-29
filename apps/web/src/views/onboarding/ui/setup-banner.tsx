'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowRight, Rocket } from 'lucide-react'
import { fetchOnboardingState, onboardingKeys } from '../../../entities/onboarding'
import { Button, Card } from '../../../shared/ui'

/**
 * Приглашение вернуться в мастер — на обзорной странице админа вуза.
 *
 * Мастер, который открывается один раз и больше о себе не напоминает, бросают на третьем
 * шаге: настройку вуза не делают за один присест. Поэтому напоминание живёт там, куда
 * админ приходит каждый день, и исчезает, как только вуз запущен.
 *
 * Пока запрос идёт, не рисуется ничего: пустая карточка-скелетон на обзоре мигала бы
 * при каждом заходе ради блока, которого у запущенного вуза уже нет.
 */
export function SetupBanner() {
  const t = useTranslations('Setup')
  const state = useQuery({
    queryKey: onboardingKeys.state(),
    queryFn: fetchOnboardingState,
    // Обзор открывают часто, а структура вуза меняется редко.
    staleTime: 60_000,
  })

  const data = state.data
  if (!data || data.completedAt || data.university.status === 'ACTIVE') return null

  const done = data.steps.filter((s) => s.done || s.skipped).length

  return (
    // Иконка, текст и кнопка стоят по одной средней линии: при выравнивании по верху
    // иконка висела над двухстрочным текстом, а кнопка — посередине, и строка
    // разваливалась на три разных уровня.
    <Card className="flex flex-col gap-4 px-4 ring-primary/25 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Rocket className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">{t('bannerTitle')}</span>
          <span className="text-sm text-muted-foreground">
            {t('bannerText', { done, total: data.steps.length })}
          </span>
          <div className="mt-1 h-1 max-w-md overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(done / data.steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
      <Button asChild className="shrink-0">
        <Link href="/university-admin/setup">
          {t('bannerAction')}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </Card>
  )
}
