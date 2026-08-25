'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  CalendarClock,
  ClipboardList,
  Inbox,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  assignmentKeys,
  fetchAssignments,
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

// «Задания» преподавателя (задача 3): список своих дисциплин + создание/публикация.
// Workspace проверки (задача 4) — отдельным экраном.
export function TeacherAssignmentsView() {
  const t = useTranslations('Assignments')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [gradingId, setGradingId] = useState<string | null>(null)

  const q = useQuery({ queryKey: assignmentKeys.list(), queryFn: () => fetchAssignments() })

  if (gradingId) {
    return <GradingWorkspace assignmentId={gradingId} onBack={() => setGradingId(null)} />
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: assignmentKeys.list() })

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

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newAssignment')}
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t('emptyTeacher')}
          description={t('emptyTeacherHint')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((a) => (
            <li key={a.id}>
              <Card>
                <CardContent className="flex items-center gap-3 p-3.5">
                  <button
                    type="button"
                    onClick={() => setGradingId(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ClipboardList className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.title}</span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="truncate">
                          {a.course.subject.name} · {a.course.group.name}
                        </span>
                        {a.dueAt && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-3" aria-hidden />
                            {new Date(a.dueAt).toLocaleDateString(locale, {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <Badge variant={STATUS_BADGE[a.status]} className="shrink-0">
                    {t(`astatus.${a.status}`)}
                  </Badge>
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
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(a)}>
                        <Trash2 aria-hidden />
                        {t('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateAssignmentModal onClose={() => setCreating(false)} />}
    </div>
  )
}
