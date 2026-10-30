'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SegmentedTabs } from '../../../shared/ui'

const CATALOG = '/books'
const MINE = '/my-books'

type Tab = typeof CATALOG | typeof MINE

/** Вкладки раздела «Библиотека» у студента: каталог и мои книги. */
export function LibraryReaderTabs() {
  const t = useTranslations('LibraryReader')
  const router = useRouter()
  const pathname = usePathname()
  const value: Tab = pathname.startsWith(MINE) ? MINE : CATALOG
  return (
    <SegmentedTabs<Tab>
      value={value}
      aria-label={t('title')}
      onChange={(next) => router.push(next)}
      items={[
        { value: CATALOG, label: t('tabCatalog') },
        { value: MINE, label: t('tabMine') },
      ]}
    />
  )
}
