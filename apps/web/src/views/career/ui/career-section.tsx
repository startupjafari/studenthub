'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { EmptyState, PageHeader } from '../../../shared/ui'

/**
 * Каркас раздела карьерного модуля. Пока внутри — состояние «в разработке»:
 * навигация продукта уже полная, чтобы структура была видна, а сами разделы
 * наполняются задачами Фазы 18.
 */
export function CareerSection({ title, icon }: { title: string; icon: ReactNode }) {
  const t = useTranslations('Products')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title={title} />
      <EmptyState icon={icon} title={t('career.soonTitle')} description={t('career.soonText')} />
    </div>
  )
}
