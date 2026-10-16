'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Archive,
  FolderInput,
  Inbox,
  LayoutGrid,
  Send,
  ShieldCheck,
  Building2,
  type LucideIcon,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { PageHeader, SegmentedTabs } from '../../../shared/ui'
import { OverviewPanel, type OverviewOpen } from './overview-panel'
import { DocumentsList } from './documents-list'
import { RequestsPanel } from './requests-panel'
import { SharedWithMe } from './shared-with-me'

type Section = 'overview' | 'my' | 'requests' | 'shared' | 'from-university' | 'access' | 'archive'

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: 'overview', icon: LayoutGrid },
  { id: 'my', icon: Inbox },
  { id: 'requests', icon: Send },
  { id: 'shared', icon: FolderInput },
  { id: 'from-university', icon: Building2 },
  { id: 'access', icon: ShieldCheck },
  { id: 'archive', icon: Archive },
]

// Кому студенты открывают документы из веба: деканату факультета (декан) и вузу
// (администрация). Остальным раздел «Открытые мне» был бы всегда пуст.
const SHARED_RECIPIENT_ROLES: ReadonlySet<Role> = new Set([
  Role.DEAN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
])

// Раздел «Документы» (Ф15): защищённое хранилище с под-навигацией (ТЗ §2).
export function DocumentsView() {
  const t = useTranslations('Documents')
  const role = useAppSelector((s) => s.auth.role)
  // Диплинк из уведомления о выданном доступе: /documents?section=shared. По нему раздел
  // открывается любой роли — персональный доступ можно выдать не только администрации.
  const requested = useSearchParams().get('section')
  const canReceive = requested === 'shared' || (!!role && SHARED_RECIPIENT_ROLES.has(role))
  const [section, setSection] = useState<Section>(() =>
    requested === 'shared' ? 'shared' : 'overview',
  )
  // Переход по уведомлению, когда раздел уже открыт: страница не пересоздаётся.
  useEffect(() => {
    if (requested === 'shared') setSection('shared')
  }, [requested])
  // Фильтр, с которым открывают «Мои документы» из обзора (клик по плитке/строке).
  const [listStatus, setListStatus] = useState<string | undefined>(undefined)

  const open: OverviewOpen = (target, status) => {
    setListStatus(status)
    setSection(target === 'requests' ? 'requests' : 'my')
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
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
            items={SECTIONS.filter((s) => s.id !== 'shared' || canReceive).map((s) => ({
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
      {section === 'shared' && canReceive && <SharedWithMe />}
    </div>
  )
}
