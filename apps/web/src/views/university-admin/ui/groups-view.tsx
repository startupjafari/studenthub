'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { ChevronDown, Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
  TablePagination,
  useConfirm,
} from '../../../shared/ui'
import { fetchFaculties, facultyKeys, type Faculty } from '../../../entities/faculty'
import { CreateGroupModal } from './create-group-modal'
import { AssignStarosta } from '../../../features/assign-starosta'
import { EditGroupModal } from './edit-group-modal'
import {
  deleteGroupRequest,
  fetchGroupMembers,
  fetchGroupsPaged,
  groupKeys,
  type Group,
} from '../../../entities/group'
import { ProfileLink } from '../../../entities/user'
import { cn } from '../../../shared/lib/utils'

// Потолок 100 — столько разрешает OffsetPaginationSchema, на которой построен GET /groups.
const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250
// Предел `search` в GroupListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

// Что мешает удалить группу — сервер кладёт вид записей в details.field (groups.service.ts).
const GROUP_BLOCKERS = ['students', 'schedule', 'courses', 'exams', 'materials'] as const
type GroupBlocker = (typeof GROUP_BLOCKERS)[number]

function groupBlockers(e: unknown): GroupBlocker[] {
  const details = (e as { details?: { field?: string }[] }).details ?? []
  return GROUP_BLOCKERS.filter((b) => details.some((d) => d.field === b))
}

function initials(f: string, l: string): string {
  return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase()
}

// Строка группы: имя/факультет/курс + разворот участников с назначением старосты + удаление.
function GroupRow({ group, facultyName }: { group: Group; facultyName?: string }) {
  const qc = useQueryClient()
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  const members = useQuery({
    queryKey: groupKeys.members(group.id),
    queryFn: () => fetchGroupMembers(group.id),
    enabled: open,
  })

  const deleteMut = useMutation({
    mutationFn: () => deleteGroupRequest(group.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupKeys.list() })
      toast.success(t('groupDeleted'))
    },
    onError: (e) => {
      const code = errCode(e)
      if (code !== 'CONFLICT') {
        toast.error(tErr(code))
        return
      }
      // Сервер отказал и перечислил, что держит группу: студенты, расписание, курсы,
      // экзамены, материалы. Показываем перечень, чтобы было ясно, что разбирать.
      const blockers = groupBlockers(e)
      toast.error(t('groupDeleteBlocked'), {
        description: blockers.length
          ? t('groupDeleteBlockedList', {
              list: blockers.map((b) => t(`groupBlockers.${b}`)).join(', '),
            })
          : undefined,
      })
    },
  })

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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
            <p className="font-medium">{group.name}</p>
            <p className="text-xs text-muted-foreground">
              {facultyName ?? '—'}
              {group.year ? ` · ${group.year}` : ''}
            </p>
          </div>
        </button>
        {group.starostaId && <Badge variant="info">{t('hasStarosta')}</Badge>}
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={t('editGroup')}
          title={t('editGroup')}
          onClick={() => setEditing(true)}
          className="text-muted-foreground"
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={t('delete')}
          loading={deleteMut.isPending}
          onClick={() => {
            void confirm({
              title: t('deleteGroupConfirm', { name: group.name }),
              // Заранее: удаляется только пустая группа, и удаление не отменить.
              description: t('deleteGroupWarning'),
              destructive: true,
            }).then((ok) => {
              if (ok) deleteMut.mutate()
            })
          }}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          {members.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : members.data && members.data.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {members.data.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    <ProfileLink userId={m.id} className="flex items-center gap-2">
                      <Avatar className="size-7">
                        {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                        <AvatarFallback className="text-xs">
                          {initials(m.firstName, m.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <span>
                        {m.firstName} {m.lastName}
                      </span>
                    </ProfileLink>
                    <span className="text-xs text-muted-foreground">{tRoles(m.role)}</span>
                    {group.starostaId === m.id && (
                      <Badge variant="info" className="ml-auto">
                        {t('starosta')}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <AssignStarosta group={group} members={members.data} />
            </>
          ) : (
            <EmptyState title={t('noMembers')} className="border-0 p-6" />
          )}
        </div>
      )}
      {editing && <EditGroupModal group={group} onClose={() => setEditing(false)} />}
    </Card>
  )
}

/**
 * Группы вуза. Страницы и поиск — на сервере: раньше экран брал первые 100 групп по
 * алфавиту и молча обрезал остальные, а у вуза на 10 000 студентов их около 400.
 */
export function GroupsAdminView() {
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const tCommon = useTranslations('Common')

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  // Запрос — после паузы в наборе, со сбросом на первую страницу: иначе каждая буква
  // уходила бы отдельным запросом, а пятая страница нового поиска могла оказаться пустой.
  useEffect(() => {
    const next = search.trim().slice(0, SEARCH_MAX)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced])

  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })
  const params = { page, limit, ...(debounced ? { search: debounced } : {}) }
  const groups = useQuery({
    queryKey: groupKeys.page(params),
    queryFn: () => fetchGroupsPaged(params),
    placeholderData: keepPreviousData,
  })

  const items = groups.data?.items ?? []
  const total = groups.data?.total ?? 0

  // Удалили последнюю группу на последней странице — встаём на ту, что теперь последняя.
  useEffect(() => {
    if (!groups.data) return
    const pages = Math.max(1, Math.ceil(groups.data.total / limit))
    if (page > pages) setPage(pages)
  }, [groups.data, limit, page])

  const facultyName = (id: string): string | undefined =>
    faculties.data?.find((f: Faculty) => f.id === id)?.name

  const [createOpen, setCreateOpen] = useState(false)

  const noFaculties = faculties.data && faculties.data.length === 0

  return (
    // Без `min-h-0`: страница — обычный список, и высота должна считаться по нему.
    // С `min-h-0` корень имел право сжаться ниже содержимого, список вылезал за его
    // границы, и нижний отступ `main` оставался НАД вылезшим хвостом — последняя
    // карточка упиралась в край окна. `flex-1` при этом сохранён: на коротком списке
    // он по-прежнему растягивает страницу, чтобы пустое состояние встало по центру.
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('groupsTitle')}
        actions={
          <>
            <div className="relative w-full sm:w-56">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                size="md"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchGroups')}
                aria-label={t('searchGroups')}
                className="pl-9"
              />
            </div>
            {/* Без факультетов группу создать нельзя — у неё обязательный facultyId.
                Кнопка заблокирована, а причина написана в пустом состоянии ниже. */}
            <Button
              type="button"
              size="md"
              disabled={noFaculties}
              title={noFaculties ? t('needFacultyFirst') : undefined}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" aria-hidden />
              {t('addGroup')}
            </Button>
          </>
        }
      />

      {groups.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton fill className="min-h-16" />
          <Skeleton fill className="min-h-16" />
        </div>
      ) : groups.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : total > 0 ? (
        // Пустая страница при total > 0 — удалили последнюю группу на последней
        // странице; эффект выше уже переводит на предыдущую.
        <>
          <div className="flex flex-col gap-2">
            {items.map((g) => (
              <GroupRow key={g.id} group={g} facultyName={facultyName(g.facultyId)} />
            ))}
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
      ) : debounced ? (
        <EmptyState
          icon={<Search className="size-6" aria-hidden />}
          title={tCommon('nothingFound')}
        />
      ) : (
        <EmptyState
          icon={<Users className="size-6" aria-hidden />}
          title={t('noGroups')}
          description={noFaculties ? t('needFacultyFirst') : t('noGroupsHint')}
          action={
            noFaculties ? null : (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                {t('addGroup')}
              </Button>
            )
          }
        />
      )}

      {createOpen && <CreateGroupModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
