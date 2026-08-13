'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  CalendarClock,
  GraduationCap,
  Inbox,
  MapPin,
  MoreHorizontal,
  Plus,
  Trash2,
  Users,
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
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import { examKeys, fetchExams, deleteExamRequest, type ExamItem } from '../../../entities/exam'
import { formatKey } from '../lib/visuals'
import { CreateExamModal } from './create-exam-modal'
import { ExamResultsRoster } from './exam-results-roster'

// Управление экзаменами (декан/преподаватель): список + назначение + ведомость.
export function ExamManagementView({ mine }: { mine: boolean }) {
  const t = useTranslations('Exams')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [rosterId, setRosterId] = useState<string | null>(null)

  const q = useQuery({ queryKey: examKeys.list(), queryFn: () => fetchExams() })

  const remove = useMutation({
    mutationFn: (id: string) => deleteExamRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(t('deleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  if (rosterId) {
    return <ExamResultsRoster examId={rosterId} onBack={() => setRosterId(null)} />
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('manageTitle')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('newExam')}
          </Button>
        }
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-2">
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
          icon={<GraduationCap />}
          title={t('manageEmpty')}
          description={t('manageEmptyHint')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(q.data ?? []).map((e) => (
            <li key={e.id}>
              <ExamRow
                exam={e}
                locale={locale}
                onOpen={() => setRosterId(e.id)}
                onDelete={() => remove.mutate(e.id)}
                t={t}
              />
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateExamModal mine={mine} onClose={() => setCreating(false)} />}
    </div>
  )
}

function ExamRow({
  exam: e,
  locale,
  onOpen,
  onDelete,
  t,
}: {
  exam: ExamItem
  locale: string
  onOpen: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const d = new Date(e.date)
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GraduationCap className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{e.course.subject.name}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3" aria-hidden />
                {d.toLocaleString(locale, {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span>{e.group.name}</span>
              {e.room && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {e.room.name}
                </span>
              )}
            </span>
          </span>
          <Badge variant="secondary" className="shrink-0">
            {t(formatKey(e.format))}
          </Badge>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('actions')}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>
              <Users aria-hidden />
              {t('openRoster')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 aria-hidden />
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  )
}
