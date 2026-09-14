'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  assignmentKeys,
  fetchAssignment,
  fetchSubmissions,
  type SubmissionItem,
  type SubmissionStatus,
} from '../../../entities/assignment'
import { GradeSubmissionModal } from './grade-submission-modal'

interface Props {
  assignmentId: string
  onBack: () => void
}

const SUB_BADGE: Record<SubmissionStatus, 'secondary' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'secondary',
  SUBMITTED: 'info',
  GRADED: 'success',
  RETURNED: 'warning',
}

// Порядок статусов для сортировки: сначала то, что ждёт преподавателя.
const SUB_ORDER: SubmissionStatus[] = ['SUBMITTED', 'RETURNED', 'DRAFT', 'GRADED']

// Студент забирает остаток ширины: остальные колонки — короткие и предсказуемые.
const COLS = ['auto', '11rem', '7rem', '11rem', '6rem', '9rem'] as const
// Узкий экран: попытка и время сдачи скрыты — на строке остаются имя, статус, балл
// и кнопка проверки, то есть «кто, в каком состоянии и что с этим делать».
const COLS_NARROW = ['auto', '8rem', '0', '0', '4.5rem', '7rem'] as const
const HIDE = { attempt: 'hidden lg:table-cell', submitted: 'hidden md:table-cell' } as const
const SKELETON_COLS = [undefined, undefined, HIDE.attempt, HIDE.submitted, undefined, undefined]

/**
 * Проверка задания (задача 4): таблица сдач, оценка — в модальном окне.
 *
 * Очередь при этом сохраняется: после «Поставить балл» окно само переходит к следующей
 * работе со статусом «На проверке» в том порядке, в каком таблица отсортирована сейчас.
 * Кончились — окно закрывается, и видно всю таблицу с новыми баллами.
 */
export function GradingWorkspace({ assignmentId, onBack }: Props) {
  const t = useTranslations('Assignments')
  const locale = useLocale()

  const assignment = useQuery({
    queryKey: assignmentKeys.detail(assignmentId),
    queryFn: () => fetchAssignment(assignmentId),
  })
  const subs = useQuery({
    queryKey: assignmentKeys.submissions(assignmentId),
    queryFn: () => fetchSubmissions(assignmentId),
  })

  const [openId, setOpenId] = useState<string | null>(null)
  const list = useMemo(() => subs.data ?? [], [subs.data])

  // Сортировки по умолчанию нет: сервер отдаёт сдачи в своём порядке, и стрелка в шапке
  // означала бы выбор, которого не делали. Сортировка клиентская — сдачи приходят одним
  // ответом целиком, страниц у них нет.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<SubmissionItem>(list, (s, key) => {
    if (key === 'student') return `${s.student.lastName} ${s.student.firstName}`
    if (key === 'status') return SUB_ORDER.indexOf(s.status)
    if (key === 'attempt') return s.attemptNumber
    if (key === 'submitted') return s.submittedAt
    if (key === 'score') return s.score
    return null
  })

  const open = sorted.find((s) => s.id === openId) ?? null

  // Следующая непроверенная работа после только что оценённой — в том порядке, который
  // преподаватель видит на экране. Больше таких нет — окно закрывается.
  function goNext(afterId: string) {
    const idx = sorted.findIndex((s) => s.id === afterId)
    const next = sorted.slice(idx + 1).find((s) => s.status === 'SUBMITTED')
    setOpenId(next?.id ?? null)
  }

  const header = (
    <PageHeader
      title={assignment.data?.title ?? t('grading')}
      subtitle={
        assignment.data
          ? `${assignment.data.course.subject.name} · ${assignment.data.course.group.name}`
          : undefined
      }
      onBack={onBack}
      backLabel={t('back')}
    />
  )

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      {header}

      {!subs.isLoading && list.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t('noSubmissions')}
          description={t('noSubmissionsHint')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="student" sort={sort} onSort={toggle}>
                  {t('colStudent')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('colStatus')}
                </TableHead>
                <TableHead
                  numeric
                  sortKey="attempt"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.attempt}
                >
                  {t('colAttempt')}
                </TableHead>
                <TableHead
                  sortKey="submitted"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.submitted}
                >
                  {t('colSubmitted')}
                </TableHead>
                <TableHead numeric sortKey="score" sort={sort} onSort={toggle}>
                  {t('score')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {sorted.map((s) => (
                <TableRow
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <TableCell className="font-medium">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback>
                          {s.student.firstName[0]}
                          {s.student.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <TableText value={`${s.student.lastName} ${s.student.firstName}`} />
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={SUB_BADGE[s.status]} className="max-w-full truncate">
                      {t(`sub.${s.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn(HIDE.attempt, 'text-right tabular-nums')}>
                    {s.attemptNumber}
                  </TableCell>
                  <TableCell className={cn(HIDE.submitted, 'text-muted-foreground')}>
                    {s.submittedAt ? (
                      new Date(s.submittedAt).toLocaleString(locale, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    ) : (
                      <TableEmpty />
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {s.score ?? <TableEmpty />}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(ev) => {
                        // Строка открывает то же окно — клик по кнопке не должен
                        // сработать дважды.
                        ev.stopPropagation()
                        setOpenId(s.id)
                      }}
                    >
                      {t('review')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {open && (
        // `key` по сдаче: окно переходит к следующей работе на месте, и без него в полях
        // остались бы балл и комментарий предыдущей (состояние формы не сбрасывается).
        <GradeSubmissionModal
          key={open.id}
          assignmentId={assignmentId}
          maxScore={assignment.data?.maxScore ?? null}
          submission={open}
          onClose={() => setOpenId(null)}
          onGraded={() => goNext(open.id)}
        />
      )}
    </div>
  )
}
