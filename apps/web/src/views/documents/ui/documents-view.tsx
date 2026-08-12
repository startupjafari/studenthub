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
import { cn } from '../../../shared/lib/utils'
import { PageHeader } from '../../../shared/ui'
import { OverviewPanel } from './overview-panel'
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

  return (
    <div className="flex w-full flex-col gap-5">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        tabs={
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-muted/50 p-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const active = section === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t(`nav_${s.id}`)}
                </button>
              )
            })}
          </div>
        }
      />

      {section === 'overview' && <OverviewPanel />}
      {section === 'my' && <DocumentsList preset="active" />}
      {section === 'archive' && <DocumentsList preset="archived" />}
      {section === 'access' && <DocumentsList preset="shared" />}
      {section === 'from-university' && <DocumentsList preset="issued" />}
      {section === 'requests' && <RequestsPanel />}
    </div>
  )
}
