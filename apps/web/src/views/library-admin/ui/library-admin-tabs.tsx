'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SegmentedTabs } from '../../../shared/ui'

const SETTINGS = '/university-admin/library'
const CATALOG = '/university-admin/library/catalog'
const REPORTS = '/university-admin/library/reports'
const JOURNAL = '/university-admin/library/journal'

type Tab = typeof SETTINGS | typeof CATALOG | typeof REPORTS | typeof JOURNAL

/** Вкладки раздела «Библиотека» у админа вуза: настройки, каталог, отчёты, журнал. */
export function LibraryAdminTabs() {
  const t = useTranslations('LibraryAdmin')
  const router = useRouter()
  const pathname = usePathname()
  const value: Tab = pathname.startsWith(CATALOG)
    ? CATALOG
    : pathname.startsWith(REPORTS)
      ? REPORTS
      : pathname.startsWith(JOURNAL)
        ? JOURNAL
        : SETTINGS
  return (
    <SegmentedTabs<Tab>
      value={value}
      aria-label={t('title')}
      onChange={(next) => router.push(next)}
      items={[
        { value: SETTINGS, label: t('tabSettings') },
        { value: CATALOG, label: t('tabCatalog') },
        { value: REPORTS, label: t('tabReports') },
        { value: JOURNAL, label: t('tabJournal') },
      ]}
    />
  )
}
