'use client'

import { useTranslations } from 'next-intl'
import { useAppSelector } from '../../../shared/store'
import { GroupMembers } from '../../../widgets/group-members'
import { PageHeader } from '../../../shared/ui'

// Экран «своя группа»/«одногруппники» для старосты (groupId из auth-стейта).
export function OwnGroupView({
  titleKey,
  studentsOnly,
}: {
  titleKey: string
  studentsOnly?: boolean
}) {
  const t = useTranslations('People')
  const groupId = useAppSelector((s) => s.auth.groupId)
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(titleKey)} />
      <GroupMembers groupId={groupId} studentsOnly={studentsOnly} />
    </div>
  )
}
