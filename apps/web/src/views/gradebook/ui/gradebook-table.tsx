'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Eye, EyeOff, MoreHorizontal, Plus, Save, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Skeleton,
  useConfirm,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError, useMediaQuery } from '../../../shared/lib'
import {
  gradebookKeys,
  fetchGradebook,
  publishColumnRequest,
  deleteColumnRequest,
  saveGradesRequest,
  type GradeColumnItem,
  type GradebookStudent,
} from '../../../entities/gradebook'
import { AddColumnModal } from './add-column-modal'

const cellKey = (columnId: string, studentId: string) => `${columnId}|${studentId}`

// Журнал оценок дисциплины: матрица колонок×студентов с inline-редактированием,
// публикацией колонок (черновик/опубликовано) и итогом. Desktop — таблица, mobile — карточки.
export function GradebookTable({ courseId }: { courseId: string }) {
  const t = useTranslations('Gradebook')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  const q = useQuery({
    queryKey: gradebookKeys.course(courseId),
    queryFn: () => fetchGradebook(courseId),
  })

  useEffect(() => {
    if (!q.data) return
    const next: Record<string, string> = {}
    for (const g of q.data.grades) {
      if (g.score != null) next[cellKey(g.columnId, g.studentId)] = String(g.score)
    }
    setValues(next)
    setDirty(new Set())
  }, [q.data])

  const invalidate = () => qc.invalidateQueries({ queryKey: gradebookKeys.course(courseId) })

  const setCell = (columnId: string, studentId: string, v: string) => {
    setValues((prev) => ({ ...prev, [cellKey(columnId, studentId)]: v }))
    setDirty((prev) => new Set(prev).add(columnId))
  }

  const save = useMutation({
    mutationFn: async () => {
      const students = q.data?.students ?? []
      for (const columnId of dirty) {
        const entries = students.map((s) => {
          const raw = values[cellKey(columnId, s.id)]
          const score = raw === undefined || raw === '' ? null : Number(raw)
          return { studentId: s.id, score: Number.isNaN(score as number) ? null : score }
        })
        await saveGradesRequest({ columnId, entries })
      }
    },
    onSuccess: () => {
      invalidate()
      toast.success(t('saved'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      publishColumnRequest(id, published),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })
  const removeCol = useMutation({
    mutationFn: (id: string) => deleteColumnRequest(id),
    onSuccess: () => {
      invalidate()
      toast.success(t('columnDeleted'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  async function onDeleteColumn(col: GradeColumnItem) {
    const ok = await confirm({
      title: t('confirmDeleteColumn'),
      description: col.title,
      destructive: true,
    })
    if (ok) removeCol.mutate(col.id)
  }

  const total = useMemo(() => {
    const cols = q.data?.columns ?? []
    return (studentId: string): string => {
      const scored = cols
        .map((c) => {
          const raw = values[cellKey(c.id, studentId)]
          if (raw === undefined || raw === '' || c.maxScore == null) return null
          const n = Number(raw)
          return Number.isNaN(n) ? null : n / c.maxScore
        })
        .filter((x): x is number => x !== null)
      if (scored.length === 0) return '—'
      return `${Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)}%`
    }
  }, [q.data?.columns, values])

  if (q.isLoading) return <Skeleton className="h-80 w-full rounded-xl" />
  if (!q.data) return null
  const { columns, students } = q.data

  const toolbar = (
    <div className="flex items-center justify-between gap-3">
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
        <Plus className="size-4" aria-hidden />
        {t('addColumn')}
      </Button>
      <Button
        size="sm"
        className="gap-1.5"
        onClick={() => save.mutate()}
        loading={save.isPending}
        disabled={dirty.size === 0}
      >
        <Save className="size-4" aria-hidden />
        {t('save')}
      </Button>
    </div>
  )

  const columnMenu = (col: GradeColumnItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={t('columnActions')}>
          <MoreHorizontal className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => publish.mutate({ id: col.id, published: !col.published })}>
          {col.published ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {col.published ? t('unpublish') : t('publish')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDeleteColumn(col)}>
          <Trash2 aria-hidden />
          {t('deleteColumn')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (columns.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <EmptyState icon={<Plus />} title={t('noColumns')} description={t('noColumnsHint')} />
        {adding && <AddColumnModal courseId={courseId} onClose={() => setAdding(false)} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {toolbar}

      {isDesktop ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                    {t('student')}
                  </th>
                  {columns.map((col) => (
                    <th key={col.id} className="px-2 py-2 text-center font-medium">
                      <div className="flex items-center justify-center gap-1">
                        <span className="truncate">{col.title}</span>
                        {columnMenu(col)}
                      </div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-normal">
                        {col.maxScore != null && <span>/{col.maxScore}</span>}
                        {!col.published && <Badge variant="secondary">{t('draft')}</Badge>}
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center font-medium">{t('total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((s) => (
                  <tr key={s.id}>
                    <td className="sticky left-0 z-10 truncate bg-card px-3 py-1.5 font-medium">
                      {s.lastName} {s.firstName[0]}.
                    </td>
                    {columns.map((col) => (
                      <td key={col.id} className="px-2 py-1.5 text-center">
                        <Input
                          type="number"
                          value={values[cellKey(col.id, s.id)] ?? ''}
                          onChange={(e) => setCell(col.id, s.id, e.target.value)}
                          className={cn(
                            'mx-auto h-8 w-16 px-2 text-center',
                            !col.published && 'bg-muted/40',
                          )}
                          max={col.maxScore ?? undefined}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-center font-semibold tabular-nums">
                      {total(s.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {students.map((s) => (
            <StudentCard
              key={s.id}
              student={s}
              columns={columns}
              values={values}
              setCell={setCell}
              total={total(s.id)}
              t={t}
            />
          ))}
        </ul>
      )}

      {adding && <AddColumnModal courseId={courseId} onClose={() => setAdding(false)} />}
    </div>
  )
}

function StudentCard({
  student,
  columns,
  values,
  setCell,
  total,
  t,
}: {
  student: GradebookStudent
  columns: GradeColumnItem[]
  values: Record<string, string>
  setCell: (columnId: string, studentId: string, v: string) => void
  total: string
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {student.lastName} {student.firstName}
            </span>
            <span className="text-sm font-semibold tabular-nums text-primary">{total}</span>
          </div>
          <div className="flex flex-col gap-2">
            {columns.map((col) => (
              <div key={col.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {col.title}
                  {col.maxScore != null && (
                    <span className="text-muted-foreground"> /{col.maxScore}</span>
                  )}
                  {!col.published && (
                    <Badge variant="secondary" className="ml-1.5">
                      {t('draft')}
                    </Badge>
                  )}
                </span>
                <Input
                  type="number"
                  value={values[cellKey(col.id, student.id)] ?? ''}
                  onChange={(e) => setCell(col.id, student.id, e.target.value)}
                  className="h-8 w-20 text-center"
                  max={col.maxScore ?? undefined}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </li>
  )
}
