'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { GroupSelect } from '../../../entities/group'
import { PageHeader } from '../../../shared/ui'
import { ScheduleGrid } from '../../../widgets/schedule-grid'

// Роли, видящие несколько групп → показываем фильтр по группе (студент/староста — только своя).
const MULTI_GROUP_ROLES: Role[] = [
  Role.DEAN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
]

export function ScheduleView() {
  const t = useTranslations('Schedule')
  const role = useAppSelector((s) => s.auth.role)
  const canFilter = role !== null && MULTI_GROUP_ROLES.includes(role)
  const [groupId, setGroupId] = useState<string | null>(null)

  const filters = groupId ? { groupId } : {}

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          canFilter && (
            // Поиск по группам на сервере: список из первых 100 по алфавиту не давал
            // открыть расписание хвоста алфавита в большом вузе. Пустое значение — «все
            // группы»; сбрасывается крестиком в поле.
            <div className="w-56 sm:w-64">
              <GroupSelect value={groupId} onChange={setGroupId} placeholder={t('allGroups')} />
            </div>
          )
        }
      />
      <ScheduleGrid filters={filters} />
    </div>
  )
}
