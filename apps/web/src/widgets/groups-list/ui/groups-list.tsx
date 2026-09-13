'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronDown, Users } from 'lucide-react'
import { fetchGroups, groupKeys } from '../../../entities/group'
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
 * Чего здесь нет и быть не должно — действий администратора: создания группы, удаления
 * и назначения старосты. Это различие в ПРАВАХ, а не в структуре: API их этим ролям и
 * не даст (PROJECT.md, матрица доступа).
 */
export function GroupsList({ title }: { title: string }) {
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
                  <div className="border-t border-border p-4">
                    <GroupMembers groupId={g.id} />
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
