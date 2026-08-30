'use client'

import { useTranslations } from 'next-intl'
import { BriefcaseBusiness, CalendarDays, FileUser, Search, Send } from 'lucide-react'
import { CareerSection } from './career-section'

// По одному компоненту на раздел: ключи i18n статические, сборка вида t(`nav.${x}`)
// запрещена правилами (FRONTEND_RULES §10).

export function CareerVacanciesView() {
  const t = useTranslations('Nav')
  return <CareerSection title={t('vacancies')} icon={<Search className="size-6" aria-hidden />} />
}

export function CareerApplicationsView() {
  const t = useTranslations('Nav')
  return (
    <CareerSection title={t('careerApplications')} icon={<Send className="size-6" aria-hidden />} />
  )
}

export function CareerProfileView() {
  const t = useTranslations('Nav')
  return (
    <CareerSection
      title={t('careerProfile')}
      icon={<BriefcaseBusiness className="size-6" aria-hidden />}
    />
  )
}

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
