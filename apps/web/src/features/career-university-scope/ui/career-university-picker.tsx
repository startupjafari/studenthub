'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Building2 } from 'lucide-react'
import { fetchUniversities, universityKeys } from '../../../entities/university'
import {
  buttonVariants,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useCareerUniversity } from '../model/use-career-university'

/**
 * Переключатель вуза карьерного центра. Живёт на «Обзоре» — там его один раз выбирают,
 * остальные разделы берут выбор из стора. Показывается только ролям без своего вуза
 * (платформенные админ и модератор): у сотрудника вуз в токене и выбирать нечего.
 */
export function CareerUniversityPicker() {
  const t = useTranslations('CareerAdmin')
  const { needsPick, universityId, select } = useCareerUniversity()
  const list = useQuery({
    queryKey: universityKeys.list(),
    queryFn: fetchUniversities,
    enabled: needsPick,
  })

  if (!needsPick) return null
  if (list.isLoading) return <Skeleton className="h-8 w-full rounded-lg" />

  return (
    <Select value={universityId ?? undefined} onValueChange={select}>
      <SelectTrigger
        size="sm"
        className="w-full justify-start gap-2 text-xs"
        aria-label={t('pickUniversity')}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue placeholder={t('pickUniversity')} />
      </SelectTrigger>
      <SelectContent>
        {(list.data ?? []).map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.shortName || u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Заглушка вместо содержимого раздела, пока вуз не выбран. Без неё страница уходила бы
 * запросом в заведомый `WRONG_SCOPE` и показывала отказ сервера как поломку.
 */
export function CareerUniversityRequired() {
  const t = useTranslations('CareerAdmin')
  return (
    <EmptyState
      icon={<Building2 className="size-6" aria-hidden />}
      title={t('pickUniversity')}
      description={t('pickHint')}
      // Выбор живёт на «Обзоре», поэтому заглушка не просто объясняет, а ведёт туда.
      action={
        <Link href="/career" className={cn(buttonVariants({ variant: 'outline' }))}>
          {t('goOverview')}
        </Link>
      }
    />
  )
}
