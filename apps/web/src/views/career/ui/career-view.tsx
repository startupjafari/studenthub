'use client'

import { useTranslations } from 'next-intl'
import { Briefcase } from 'lucide-react'
import { EmptyState, PageHeader } from '../../../shared/ui'

// Заглушка корня карьерного продукта: переключатель под логотипом уже ведёт сюда,
// а разделы модуля появятся отдельными задачами (Фаза 18).
export function CareerView() {
  const t = useTranslations('Products')

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('career.title')} subtitle={t('career.hint')} />
      <EmptyState
        icon={<Briefcase className="size-6" aria-hidden />}
        title={t('career.soonTitle')}
        description={t('career.soonText')}
      />
    </div>
  )
}
