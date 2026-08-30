'use client'

import { useTranslations } from 'next-intl'
import { CalendarDays, FileUser } from 'lucide-react'
import { CareerSection } from './career-section'

// По одному компоненту на раздел: ключи i18n статические, сборка вида t(`nav.${x}`)
// запрещена правилами (FRONTEND_RULES §10).

export function CareerResumeView() {
  const t = useTranslations('Nav')
  return <CareerSection title={t('resume')} icon={<FileUser className="size-6" aria-hidden />} />
}

export function CareerEventsView() {
  const t = useTranslations('Nav')
  return (
    <CareerSection
      title={t('careerEvents')}
      icon={<CalendarDays className="size-6" aria-hidden />}
    />
  )
}
