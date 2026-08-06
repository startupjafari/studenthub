'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronDown, Users } from 'lucide-react'
import { fetchGroups, groupKeys } from '../../../entities/group'
import { Card, CardContent, EmptyState, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { GroupMembers } from '../../group-members'

// Список групп в scope роли (декан → факультет, преподаватель/админ → вуз) с раскрытием участников.
export function GroupsList({ title }: { title: string }) {
  const tErr = useTranslations('Errors')
  const t = useTranslations('People')
  const [openId, setOpenId] = useState<string | null>(null)

  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      {groups.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : groups.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (groups.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('noGroups')} />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.data!.map((g) => (
            <Card key={g.id}>
              <button
                type="button"
                onClick={() => setOpenId((v) => (v === g.id ? null : g.id))}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Users className="size-4 text-primary" aria-hidden />
                  {g.name}
                  {g.year && <span className="text-xs text-muted-foreground">· {g.year}</span>}
                </span>
                <ChevronDown
                  className={cn('size-4 transition-transform', openId === g.id && 'rotate-180')}
                  aria-hidden
                />
              </button>
              {openId === g.id && (
                <CardContent className="pt-0">
                  <GroupMembers groupId={g.id} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
