'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronDown, Users } from 'lucide-react'
import { fetchGroupMembers, fetchGroups, groupKeys, type Group } from '../../../entities/group'
import { AssignStarosta } from '../../../features/assign-starosta'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { GroupMembers } from '../../group-members'

/**
 * Список групп в scope роли (декан → факультет, преподаватель → вуз) с раскрытием
 * участников.
 *
 * Собран по той же схеме, что «Группы» админа вуза (views/university-admin), — один
 * раздел не должен выглядеть у трёх ролей по-разному: тот же каркас страницы, та же
 * строка (шеврон слева, название и год второй строкой, признак старосты справа), тот
 * же скелетон и то же пустое состояние.
 *
 * Создания и удаления групп здесь нет — это права админа вуза. Назначение старосты
 * включается флагом `manageStarosta`: его даёт декан (PATCH /groups/:id/starosta разрешён
 * декану своего факультета), преподавателю список только для чтения.
 */
export function GroupsList({
  title,
  manageStarosta = false,
}: {
  title: string
  manageStarosta?: boolean
}) {
  const tErr = useTranslations('Errors')
  const t = useTranslations('People')
  const [openId, setOpenId] = useState<string | null>(null)

  const groups = useQuery({ queryKey: groupKeys.list(), queryFn: () => fetchGroups() })

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={title} />
      {groups.isLoading ? (
        // Скелетон повторяет форму строк, а не закрывает список одной плашкой.
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : groups.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (groups.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('noGroups')}
          description={t('noGroupsHint')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.data!.map((g) => {
            const open = openId === g.id
            return (
              <Card key={g.id} className="gap-0 p-0">
                <div className="flex items-center gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => setOpenId((v) => (v === g.id ? null : g.id))}
                    className="flex flex-1 cursor-pointer items-center gap-3 text-left"
                    aria-expanded={open}
                  >
                    <ChevronDown
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        open && 'rotate-180',
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{g.name}</p>
                      <p className="text-xs text-muted-foreground">{g.year ?? '—'}</p>
                    </div>
                  </button>
                  {g.starostaId && <Badge variant="info">{t('hasStarosta')}</Badge>}
                </div>

                {open && (
                  <div className="flex flex-col gap-3 border-t border-border p-4">
                    <GroupMembers groupId={g.id} />
                    {manageStarosta && <StarostaControl group={g} />}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Участники берутся из того же кэша, что и у списка GroupMembers выше: второго запроса нет.
function StarostaControl({ group }: { group: Group }) {
  const members = useQuery({
    queryKey: groupKeys.members(group.id),
    queryFn: () => fetchGroupMembers(group.id),
  })
  if (!members.data) return null
  return <AssignStarosta group={group} members={members.data} />
}
