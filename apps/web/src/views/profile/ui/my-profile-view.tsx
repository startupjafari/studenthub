'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Building2, UserRound } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { CompanyProfile, UserProfile } from '../../../widgets/user-profile'
import { StoryHighlightsRow, StoryViewer } from '../../../widgets/stories-rail'
import { companyKeys, fetchMyCompany } from '../../../entities/company'
import { useAppSelector } from '../../../shared/store'
import { SegmentedTabs } from '../../../shared/ui'

// Свой профиль: виджет профиля + окно сторис для кольца вокруг аватара и ряд «Актуального».
// Склейка здесь, а не в виджете: виджеты друг друга не импортируют (FRONTEND_RULES §2.1).
export function MyProfileView() {
  const role = useAppSelector((s) => s.auth.role)
  // У работодателя два профиля: свой и страница компании — с переключателем сверху.
  if (role === Role.EMPLOYER) {
    return (
      <Suspense fallback={null}>
        <EmployerProfiles />
      </Suspense>
    )
  }
  return <PersonalProfile />
}

function PersonalProfile() {
  return (
    <UserProfile
      renderStoryViewer={(ring, onClose) => (
        <StoryViewer rings={[ring]} startIndex={0} onClose={onClose} />
      )}
      renderHighlights={(ownerId) => <StoryHighlightsRow ownerId={ownerId} />}
    />
  )
}

type ProfileView = 'me' | 'company'

/**
 * Переключатель «Мой профиль / Компания». Выбор — в адресе (`?view=company`): ссылкой можно
 * поделиться, и «Назад» возвращает к прежнему профилю, а не к прежней странице.
 */
function EmployerProfiles() {
  const t = useTranslations('Company')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view: ProfileView = params.get('view') === 'company' ? 'company' : 'me'
  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })

  const toggle = (
    <SegmentedTabs<ProfileView>
      items={[
        { value: 'me', label: t('switchMe'), icon: UserRound },
        { value: 'company', label: company.data?.name ?? t('switchCompany'), icon: Building2 },
      ]}
      value={view}
      onChange={(next) => {
        const query = new URLSearchParams(params.toString())
        if (next === 'company') query.set('view', 'company')
        else query.delete('view')
        const qs = query.toString()
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      }}
      aria-label={t('switchLabel')}
      collapsible={false}
      className="self-start"
    />
  )

  if (view === 'company' && company.data) {
    return <CompanyProfile companyId={company.data.id} toolbar={toggle} />
  }
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      {toggle}
      <PersonalProfile />
    </div>
  )
}
