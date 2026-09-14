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
  // `min-h-0 flex-1` — цепочка до `main` для режима `fill` таблицы: список занимает всю
  // высоту области контента, а прокручивается тело таблицы, а не страница целиком. Так
  // же устроены остальные экраны со списками (очередь деканата, заявки студента).
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t(titleKey)} />
      <GroupMembers groupId={groupId} studentsOnly={studentsOnly} fill />
    </div>
  )
}
