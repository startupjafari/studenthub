'use client'

import { Suspense, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Building2, GraduationCap, UserRound, type LucideIcon } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { CompanyProfile, UniversityProfile, UserProfile } from '../../../widgets/user-profile'
import { StoryHighlightsRow, StoryViewer } from '../../../widgets/stories-rail'
import { companyKeys, fetchMyCompany } from '../../../entities/company'
import { fetchUniversityPage, universityKeys } from '../../../entities/university'
import { useAppSelector } from '../../../shared/store'
import { SegmentedTabs } from '../../../shared/ui'

// Публикуют от имени вуза — у них второй профиль: страница университета.
const UNIVERSITY_PAGE_ROLES: readonly Role[] = [Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR]

// Свой профиль: виджет профиля + окно сторис для кольца вокруг аватара и ряд «Актуального».
// Склейка здесь, а не в виджете: виджеты друг друга не импортируют (FRONTEND_RULES §2.1).
export function MyProfileView() {
  const role = useAppSelector((s) => s.auth.role)
  const universityId = useAppSelector((s) => s.auth.universityId)
  // У работодателя и у админа/модератора вуза два профиля: свой и страница организации —
  // с переключателем на обложке.
  if (role === Role.EMPLOYER) {
    return (
      <Suspense fallback={null}>
        <EmployerProfiles />
      </Suspense>
    )
  }
  if (role && UNIVERSITY_PAGE_ROLES.includes(role) && universityId) {
    return (
      <Suspense fallback={null}>
        <UniversityProfiles universityId={universityId} />
      </Suspense>
    )
  }
  return <PersonalProfile />
}

function PersonalProfile({ toolbar }: { toolbar?: ReactNode } = {}) {
  return (
    <UserProfile
      toolbar={toolbar}
      renderStoryViewer={(ring, onClose) => (
        <StoryViewer rings={[ring]} startIndex={0} onClose={onClose} />
      )}
      renderHighlights={(ownerId) => <StoryHighlightsRow ownerId={ownerId} />}
    />
  )
}

type ProfileView = 'me' | 'org'

/**
 * Какой профиль открыт. Выбор — в адресе (`?view=company|university`): ссылкой можно
 * поделиться, и «Назад» возвращает к прежнему профилю, а не к прежней странице.
 */
function useProfileView(orgParam: 'company' | 'university') {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view: ProfileView = params.get('view') === orgParam ? 'org' : 'me'
  const setView = (next: ProfileView): void => {
    const query = new URLSearchParams(params.toString())
    if (next === 'org') query.set('view', orgParam)
    else query.delete('view')
    const qs = query.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  return { view, setView }
}

/** Переключатель «Мой профиль / Организация» — лежит на обложке шапки профиля. */
function ProfileSwitch({
  view,
  onChange,
  orgLabel,
  orgIcon,
}: {
  view: ProfileView
  onChange: (next: ProfileView) => void
  orgLabel: string
  orgIcon: LucideIcon
}) {
  const t = useTranslations('OrgPage')
  return (
    <SegmentedTabs<ProfileView>
      items={[
        { value: 'me', label: t('switchMe'), icon: UserRound },
        {
          value: 'org',
          // Длинное название не выталкивает переключатель за край обложки.
          label: <span className="max-w-32 truncate sm:max-w-56">{orgLabel}</span>,
          icon: orgIcon,
        },
      ]}
      value={view}
      onChange={onChange}
      aria-label={t('switchLabel')}
      collapsible={false}
      compact
      // Переключатель лежит на обложке: плотный фон, чтобы читался на любой картинке.
      className="border-transparent bg-background/85 shadow-md backdrop-blur"
    />
  )
}

function EmployerProfiles() {
  const t = useTranslations('Company')
  const { view, setView } = useProfileView('company')
  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })
  const toggle = (
    <ProfileSwitch
      view={view}
      onChange={setView}
      orgLabel={company.data?.name ?? t('switchCompany')}
      orgIcon={Building2}
    />
  )
  if (view === 'org' && company.data) {
    return <CompanyProfile companyId={company.data.id} toolbar={toggle} />
  }
  return <PersonalProfile toolbar={toggle} />
}

function UniversityProfiles({ universityId }: { universityId: string }) {
  const t = useTranslations('University')
  const { view, setView } = useProfileView('university')
  // Название вуза для переключателя — тот же запрос, что у самой страницы (общий кэш).
  const page = useQuery({
    queryKey: universityKeys.page(universityId),
    queryFn: () => fetchUniversityPage(universityId),
  })
  const toggle = (
    <ProfileSwitch
      view={view}
      onChange={setView}
      orgLabel={page.data?.shortName ?? page.data?.name ?? t('switchUniversity')}
      orgIcon={GraduationCap}
    />
  )
  if (view === 'org') return <UniversityProfile universityId={universityId} toolbar={toggle} />
  return <PersonalProfile toolbar={toggle} />
}
