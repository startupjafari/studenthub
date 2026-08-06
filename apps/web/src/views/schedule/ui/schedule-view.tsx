'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../shared/ui'
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
  const [groupId, setGroupId] = useState<string>('')

  const groups = useQuery({
    queryKey: groupKeys.list(),
    queryFn: () => fetchGroups(),
    enabled: canFilter,
  })

  const filters = groupId ? { groupId } : {}

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {canFilter && (
          <div className="w-full sm:w-64">
            <Select
              value={groupId || 'all'}
              onValueChange={(v) => setGroupId(v === 'all' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('allGroups')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allGroups')}</SelectItem>
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <ScheduleGrid filters={filters} />
    </div>
  )
}
