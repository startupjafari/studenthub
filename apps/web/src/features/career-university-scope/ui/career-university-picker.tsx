'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Building2 } from 'lucide-react'
import { UniversitySelect } from '../../../entities/university'
import { buttonVariants, EmptyState } from '../../../shared/ui'
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

  if (!needsPick) return null

  // Серверный поиск: вузов больше, чем отдаёт одна страница (предел 200), и хвост
  // алфавита в прежнем выпадающем списке выбрать было нельзя. Очистка выбора не
  // сбрасывает вуз — без него разделу нечего показать.
  return (
    <UniversitySelect
      value={universityId}
      onChange={(id) => {
        if (id) select(id)
      }}
      size="sm"
      placeholder={t('pickUniversity')}
      short
    />
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
