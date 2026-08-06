'use client'

import { useTranslations } from 'next-intl'
import { useAppSelector } from '../../../shared/store'
import { GroupMembers } from '../../../widgets/group-members'

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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{t(titleKey)}</h1>
      <GroupMembers groupId={groupId} studentsOnly={studentsOnly} />
    </div>
  )
}
