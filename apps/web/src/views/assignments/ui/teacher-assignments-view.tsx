'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ClipboardList, Inbox, MoreHorizontal, Plus, Send, Trash2, XCircle } from 'lucide-react'
import type { AssignmentSort } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useConfirm,
  usePagedSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import {
  assignmentKeys,
  fetchAssignmentsPaged,
  publishAssignmentRequest,
  closeAssignmentRequest,
  deleteAssignmentRequest,
  type AssignmentItem,
  type AssignmentStatus,
} from '../../../entities/assignment'
import { CreateAssignmentModal } from './create-assignment-modal'
import { GradingWorkspace } from './grading-workspace'

const STATUS_BADGE: Record<AssignmentStatus, 'secondary' | 'success' | 'outline'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'success',
  CLOSED: 'outline',
}

// Задание · дисциплина · группа · срок · статус · действия.
const COLS = ['30%', '20%', '12%', '12%', '14%', '3.5rem'] as const
// На узком экране остаются задание, статус и действия: дисциплина, группа и срок —
// уточнения, без них строка всё ещё отвечает «что это и опубликовано ли».
const COLS_NARROW = ['60%', '0', '0', '0', '28%', '3.5rem'] as const
const HIDE = {
  subject: 'hidden lg:table-cell',
  group: 'hidden xl:table-cell',
  dueAt: 'hidden md:table-cell',
}
const SKELETON_COLS = 6
const PAGE_SIZES = [20, 50, 100] as const

/**
 * «Задания» преподавателя (задача 3): свои дисциплины, создание и публикация.
 * Workspace проверки (задача 4) — отдельный экран.
 *
 * Таблица, а не карточки: заданий за семестр десятки, и в списке их нельзя было ни
 * упорядочить, ни пролистать. Страница и порядок считаются на сервере — сортировка
 * в браузере переставляла бы только текущую страницу.
 */
export function TeacherAssignmentsView() {
  const t = useTranslations('Assignments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [gradingId, setGradingId] = useState<string | null>(null)
  const paged = usePagedSort<AssignmentSort>()

  const q = useQuery({
    queryKey: assignmentKeys.listPaged(paged.query),
    queryFn: () => fetchAssignmentsPaged(paged.query),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: assignmentKeys.all })

  const publish = useMutation({
    mutationFn: (id: string) => publishAssignmentRequest(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('published'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const close = useMutation({
    mutationFn: (id: string) => closeAssignmentRequest(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('closed'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteAssignmentRequest(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  async function onDelete(a: AssignmentItem) {
    const ok = await confirm({ title: t('confirmDelete'), description: a.title, destructive: true })
    if (ok) remove.mutate(a.id)
  }

  // Ранний выход — ПОСЛЕ всех хуков. Раньше он стоял выше `useMutation`, и открытие
  // проверки меняло число хуков между рендерами: React бросал исключение, экран уходил
  // в общий error boundary («Что-то пошло не так»).
  if (gradingId) {
    return <GradingWorkspace assignmentId={gradingId} onBack={() => setGradingId(null)} />
  }

  const rows = q.data?.items ?? []
  const total = q.data?.total ?? 0

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          <Button size="md" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newAssignment')}
          </Button>
        }
      />

      {q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : !q.isLoading && total === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t('emptyTeacher')}
          description={t('emptyTeacherHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="title" sort={paged.sort} onSort={paged.toggle}>
                  {t('colTitle')}
                </TableHead>
                <TableHead
                  sortKey="subject"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.subject}
                >
                  {t('colSubject')}
                </TableHead>
                <TableHead
                  sortKey="group"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.group}
                >
                  {t('colGroup')}
                </TableHead>
                <TableHead
                  sortKey="dueAt"
                  sort={paged.sort}
                  onSort={paged.toggle}
                  className={HIDE.dueAt}
                >
                  {t('colDue')}
                </TableHead>
                <TableHead sortKey="status" sort={paged.sort} onSort={paged.toggle}>
                  {t('colStatus')}
                </TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {/* Строка ведёт в проверку — там сдачи, оценки и обратная связь. */}
                    <button
                      type="button"
                      onClick={() => setGradingId(a.id)}
                      className="w-full cursor-pointer text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <TableText value={a.title} />
                    </button>
                  </TableCell>
                  <TableCell className={cn(HIDE.subject, 'text-muted-foreground')}>
                    <TableText value={a.course.subject.name} />
                  </TableCell>
                  <TableCell className={cn(HIDE.group, 'text-muted-foreground')}>
                    <TableText value={a.course.group.name} />
                  </TableCell>
                  <TableCell className={cn(HIDE.dueAt, 'text-muted-foreground tabular-nums')}>
                    {a.dueAt ? (
                      new Date(a.dueAt).toLocaleDateString(locale, {
                        day: '2-digit',
                        month: 'short',
                      })
                    ) : (
                      <TableEmpty />
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[a.status]}>{t(`astatus.${a.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" icon aria-label={t('actions')}>
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {a.status === 'DRAFT' && (
                          <DropdownMenuItem onClick={() => publish.mutate(a.id)}>
                            <Send aria-hidden />
                            {t('publish')}
                          </DropdownMenuItem>
                        )}
                        {a.status === 'PUBLISHED' && (
                          <DropdownMenuItem onClick={() => close.mutate(a.id)}>
                            <XCircle aria-hidden />
                            {t('close')}
                          </DropdownMenuItem>
                        )}
                        {/* Линия перед «Удалить» — только если над ним есть обычный пункт. */}
                        {(a.status === 'DRAFT' || a.status === 'PUBLISHED') && (
                          <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(a)}>
                          <Trash2 aria-hidden />
                          {t('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={paged.page}
            total={total}
            limit={paged.limit}
            onPageChange={paged.setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={paged.setLimit}
          />
        </Card>
      )}

      {creating && <CreateAssignmentModal onClose={() => setCreating(false)} />}
    </div>
  )
}
