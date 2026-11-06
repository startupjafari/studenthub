'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ChevronDown, Search, Users } from 'lucide-react'
import { fetchGroupMembers, fetchGroupsPaged, groupKeys, type Group } from '../../../entities/group'
import { AssignStarosta } from '../../../features/assign-starosta'
import {
  Badge,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  TablePagination,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { GroupMembers } from '../../group-members'

// Потолок 100 — столько разрешает OffsetPaginationSchema, на которой построен GET /groups.
const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250
// Предел `search` в GroupListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

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
 *
 * Страницы и поиск — на сервере, как на экране админа: раньше список брал первые 100
 * групп по алфавиту, и преподаватель большого вуза хвоста алфавита не видел вовсе.
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
  const tCommon = useTranslations('Common')
  const tAdmin = useTranslations('UniAdmin')
  const [openId, setOpenId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  // Запрос — после паузы в наборе и с первой страницы: иначе каждая буква уходила бы
  // отдельным запросом, а пятая страница нового поиска могла оказаться пустой.
  useEffect(() => {
    const next = search.trim().slice(0, SEARCH_MAX)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced])

  const params = { page, limit, ...(debounced ? { search: debounced } : {}) }
  const groups = useQuery({
    queryKey: groupKeys.page(params),
    queryFn: () => fetchGroupsPaged(params),
    placeholderData: keepPreviousData,
  })
  const items = groups.data?.items ?? []
  const total = groups.data?.total ?? 0

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={title}
        actions={
          <div className="relative w-full sm:w-56">
            <Search
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              size="md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tAdmin('searchGroups')}
              aria-label={tAdmin('searchGroups')}
              className="pl-9"
            />
          </div>
        }
      />
      {groups.isLoading ? (
        // Скелетон повторяет форму строк, а не закрывает список одной плашкой.
        <div className="flex flex-col gap-2">
          <Skeleton fill className="min-h-16" />
          <Skeleton fill className="min-h-16" />
        </div>
      ) : groups.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : total === 0 && debounced ? (
        <EmptyState
          icon={<Search className="size-6" aria-hidden />}
          title={tCommon('nothingFound')}
        />
      ) : total === 0 ? (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('noGroups')}
          description={t('noGroupsHint')}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((g) => {
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
          <Card className="gap-0 py-0">
            <TablePagination
              className="border-t-0"
              page={page}
              total={total}
              limit={limit}
              onPageChange={setPage}
              limitOptions={PAGE_SIZES}
              onLimitChange={(n) => {
                setLimit(n)
                setPage(1)
              }}
            />
          </Card>
        </>
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
