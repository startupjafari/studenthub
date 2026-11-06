'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useConfirm,
} from '../../../shared/ui'
import { fetchFaculties, facultyKeys, type Faculty } from '../../../entities/faculty'
import { CreateGroupModal } from './create-group-modal'
import { EditGroupModal } from './edit-group-modal'
import { GroupMembersModal } from './group-members-modal'
import {
  deleteGroupRequest,
  fetchGroupsPaged,
  groupKeys,
  type Group,
} from '../../../entities/group'
import { cn } from '../../../shared/lib/utils'

// Потолок 100 — столько разрешает OffsetPaginationSchema, на которой построен GET /groups.
const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 250
// Предел `search` в GroupListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

// Группа · факультет · год · староста · действия (состав, изменить, удалить).
const COLS = ['24%', '36%', '12%', 'calc(28% - 8.5rem)', '8.5rem'] as const
// Узкий экран: группа (факультет и год — строкой под ней) и действия. Колонка старосты
// уходит: с ней название сжималось до «БУ…», а старосту видно в составе группы.
const COLS_NARROW = ['calc(100% - 8.5rem)', '0', '0', '0', '8.5rem'] as const
const HIDE = {
  faculty: 'hidden md:table-cell',
  year: 'hidden md:table-cell',
  starosta: 'hidden md:table-cell',
} as const
const SKELETON_COLS = [undefined, HIDE.faculty, HIDE.year, HIDE.starosta, undefined]

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

// Строка группы. Состав и назначение старосты — окном: строку таблицы не развернуть.
function GroupRow({ group, facultyName }: { group: Group; facultyName?: string }) {
  const qc = useQueryClient()
  const t = useTranslations('UniAdmin')
  const tErr = useTranslations('Errors')
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<'members' | 'edit' | null>(null)

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

  const remove = async () => {
    const ok = await confirm({
      title: t('deleteGroupConfirm', { name: group.name }),
      // Заранее: удаляется только пустая группа, и удаление не отменить.
      description: t('deleteGroupWarning'),
      destructive: true,
    })
    if (ok) deleteMut.mutate()
  }

  return (
    <TableRow className="hover:bg-muted/40">
      <TableCell>
        <button
          type="button"
          onClick={() => setDialog('members')}
          className="block max-w-full cursor-pointer text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
        >
          <TableText value={group.name} />
        </button>
        {/* На телефоне колонки факультета нет — он строкой под названием. */}
        <span className="block text-xs text-muted-foreground md:hidden">
          <TableText value={[facultyName, group.year].filter(Boolean).join(' · ') || null} />
        </span>
      </TableCell>
      <TableCell className={cn(HIDE.faculty, 'text-muted-foreground')}>
        <TableText value={facultyName ?? null} />
      </TableCell>
      <TableCell className={cn(HIDE.year, 'text-right tabular-nums')}>
        {group.year ?? '—'}
      </TableCell>
      <TableCell className={HIDE.starosta}>
        {group.starostaId ? (
          <Badge variant="info">{t('starostaAssigned')}</Badge>
        ) : (
          <Badge variant="outline">{t('starostaNone')}</Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('groupMembers')}
            title={t('groupMembers')}
            onClick={() => setDialog('members')}
          >
            <Users className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('editGroup')}
            title={t('editGroup')}
            onClick={() => setDialog('edit')}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={t('delete')}
            title={t('delete')}
            loading={deleteMut.isPending}
            onClick={() => void remove()}
          >
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
        {dialog === 'members' && (
          <GroupMembersModal group={group} onClose={() => setDialog(null)} />
        )}
        {dialog === 'edit' && <EditGroupModal group={group} onClose={() => setDialog(null)} />}
      </TableCell>
    </TableRow>
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

  const filtered = !!debounced

  return (
    // `min-h-0` — исключение для таблицы во всю высоту (DESIGN_SYSTEM §10.7): он держит
    // flex-цепочку до тела таблицы, и прокручиваются строки, а не страница целиком.
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('groupsTitle')}
        subtitle={t('groupsSubtitle')}
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

      {groups.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !groups.isPending && total === 0 ? (
        filtered ? (
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
        )
      ) : (
        // Пустая страница при total > 0 — удалили последнюю группу на последней странице;
        // эффект выше уже переводит на предыдущую.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colGroup')}</TableHead>
                <TableHead className={HIDE.faculty}>{t('faculty')}</TableHead>
                <TableHead numeric className={HIDE.year}>
                  {t('year')}
                </TableHead>
                <TableHead className={HIDE.starosta}>{t('starosta')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('actionsColumn')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((g) => (
                <GroupRow key={g.id} group={g} facultyName={facultyName(g.facultyId)} />
              ))}
            </TableBody>
          </Table>
          <TablePagination
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
      )}

      {createOpen && <CreateGroupModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
