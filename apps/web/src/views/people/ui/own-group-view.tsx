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
  // Без `min-h-0`: экран прокручивается целиком, внутреннего скролл-контейнера тут нет.
  // С `min-h-0` колонка ужималась до высоты `main`, а карточки с `overflow-hidden`
  // резали содержимое — оно уходило за нижнюю границу без всякой прокрутки.
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t(titleKey)} />
      <GroupMembers groupId={groupId} studentsOnly={studentsOnly} />
    </div>
  )
}
