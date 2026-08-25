'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Archive,
  Inbox,
  LayoutGrid,
  Send,
  ShieldCheck,
  Building2,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader, SegmentedTabs } from '../../../shared/ui'
import { OverviewPanel, type OverviewOpen } from './overview-panel'
import { DocumentsList } from './documents-list'
import { RequestsPanel } from './requests-panel'

type Section = 'overview' | 'my' | 'requests' | 'from-university' | 'access' | 'archive'

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: 'overview', icon: LayoutGrid },
  { id: 'my', icon: Inbox },
  { id: 'requests', icon: Send },
  { id: 'from-university', icon: Building2 },
  { id: 'access', icon: ShieldCheck },
  { id: 'archive', icon: Archive },
]

// Раздел «Документы» (Ф15): защищённое хранилище с под-навигацией (ТЗ §2).
export function DocumentsView() {
  const t = useTranslations('Documents')
  const [section, setSection] = useState<Section>('overview')
  // Фильтр, с которым открывают «Мои документы» из обзора (клик по плитке/строке).
  const [listStatus, setListStatus] = useState<string | undefined>(undefined)

  const open: OverviewOpen = (target, status) => {
    setListStatus(status)
    setSection(target === 'requests' ? 'requests' : 'my')
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        tabs={
          <SegmentedTabs
            aria-label={t('title')}
            value={section}
            onChange={(next) => {
              setListStatus(undefined)
              setSection(next)
            }}
            items={SECTIONS.map((s) => ({
              value: s.id,
              icon: s.icon,
              label: t(`nav_${s.id}`),
            }))}
          />
        }
      />

      {section === 'overview' && <OverviewPanel onOpen={open} />}
      {/* key: приход из обзора с новым фильтром пересоздаёт список с этим статусом. */}
      {section === 'my' && (
        <DocumentsList preset="active" initialStatus={listStatus} key={listStatus ?? 'all'} />
      )}
      {section === 'archive' && <DocumentsList preset="archived" />}
      {section === 'access' && <DocumentsList preset="shared" />}
      {section === 'from-university' && <DocumentsList preset="issued" />}
      {section === 'requests' && <RequestsPanel />}
    </div>
  )
}
