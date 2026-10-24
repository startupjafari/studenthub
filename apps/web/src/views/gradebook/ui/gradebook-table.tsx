'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
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
  FieldError,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  useConfirm,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError, useMediaQuery } from '../../../shared/lib'
import {
  gradebookKeys,
  fetchGradebook,
  publishColumnRequest,
  deleteColumnRequest,
  saveGradesRequest,
  updateColumnRequest,
  type GradeColumnItem,
  type GradebookStudent,
} from '../../../entities/gradebook'
import { AddColumnModal } from './add-column-modal'

const cellKey = (columnId: string, studentId: string) => `${columnId}|${studentId}`

// Общий потолок схемы (SaveGradesSchema): действует, когда у колонки нет максимума.
const GRADE_CEILING = 1000

/** Верхняя граница балла колонки. */
const ceilingOf = (col: GradeColumnItem): number => col.maxScore ?? GRADE_CEILING

/**
 * Балл вне диапазона 0..максимум колонки. Пустая ячейка — не ошибка (очистка оценки).
 * Сервер проверяет то же самое, но красная ячейка сразу при вводе дешевле отказа целой
 * колонки после «Сохранить»: лишний ноль («150 из 10») видно там, где его набрали.
 */
function isOutOfRange(col: GradeColumnItem, raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  const n = Number(raw)
  return Number.isNaN(n) || n < 0 || n > ceilingOf(col)
}

// Сортировка матрицы — по студенту и по итогу. По самим колонкам оценок нет: они
// динамические, заголовок у каждой свой, и клик по нему уже занят меню колонки.
// А «Итого» — главный вопрос преподавателя к журналу: кто внизу.

// Журнал оценок дисциплины: матрица колонок×студентов с inline-редактированием,
// публикацией колонок (черновик/опубликовано) и итогом. Desktop — таблица, mobile — карточки.
export function GradebookTable({
  courseId,
  courseSelect,
}: {
  courseId: string
  /** Выбор дисциплины из `GradebookView` — стоит в шапке рядом с действиями журнала. */
  courseSelect?: ReactNode
}) {
  const t = useTranslations('Gradebook')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const confirm = useConfirm()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<GradeColumnItem | null>(null)
  // Изменённые ЯЧЕЙКИ (cellKey → введённое), а не колонки: на сохранение уходят только
  // они. Колонка целиком затирала оценки, выставленные в соседней вкладке или деканом
  // после загрузки журнала, — пустая у нас ячейка уходила как «очистить».
  //
  // Правки лежат поверх серверных значений, а не вместо них: журнал перечитывается и
  // после публикации, удаления или добавления колонки, и каждый такой ответ раньше
  // стирал всё несохранённое.
  const [edits, setEdits] = useState<Record<string, string>>({})

  const q = useQuery({
    queryKey: gradebookKeys.course(courseId),
    queryFn: () => fetchGradebook(courseId),
    // При смене дисциплины держим прежний журнал, пока грузится новый (без вспышки скелета).
    placeholderData: keepPreviousData,
  })

  // Другая дисциплина — другой журнал: правки прежней к нему не относятся.
  useEffect(() => setEdits({}), [courseId])

  const values = useMemo(() => {
    const next: Record<string, string> = {}
    for (const g of q.data?.grades ?? []) {
      if (g.score != null) next[cellKey(g.columnId, g.studentId)] = String(g.score)
    }
    return { ...next, ...edits }
  }, [q.data, edits])
  const dirtyCount = Object.keys(edits).length
  const hasEditsIn = (columnId: string) =>
    Object.keys(edits).some((key) => key.startsWith(`${columnId}|`))

  const invalidate = () => qc.invalidateQueries({ queryKey: gradebookKeys.course(courseId) })

  const setCell = (columnId: string, studentId: string, v: string) => {
    setEdits((prev) => ({ ...prev, [cellKey(columnId, studentId)]: v }))
  }

  const save = useMutation({
    mutationFn: async (sent: Record<string, string>) => {
      const byColumn = new Map<string, { studentId: string; score: number | null }[]>()
      for (const [key, raw] of Object.entries(sent)) {
        const [columnId, studentId] = key.split('|') as [string, string]
        const score = raw === '' ? null : Number(raw)
        const entries = byColumn.get(columnId) ?? []
        entries.push({ studentId, score: Number.isNaN(score as number) ? null : score })
        byColumn.set(columnId, entries)
      }
      for (const [columnId, entries] of byColumn) {
        await saveGradesRequest({ columnId, entries })
      }
    },
    onSuccess: async (_, sent) => {
      // Сначала свежий журнал, потом снимаем правки — иначе ячейка на миг показала бы
      // прежнее значение. Правку, сделанную, пока запрос летел, оставляем.
      await invalidate()
      setEdits((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([key, v]) => sent[key] !== v)),
      )
      toast.success(t('saved'))
    },
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'VALIDATION_ERROR' ? t('scoresOutOfRange') : tErr(code))
    },
  })

  // Сохранение не уходит, пока среди изменённых ячеек есть баллы вне диапазона: сервер
  // отклонил бы колонку целиком, а ячейки и так подсвечены.
  function onSave() {
    const cols = q.data?.columns ?? []
    const students = q.data?.students ?? []
    const invalid = cols.some((c) =>
      students.some((s) => {
        const key = cellKey(c.id, s.id)
        return key in edits && isOutOfRange(c, values[key])
      }),
    )
    if (invalid) {
      toast.error(t('scoresOutOfRange'))
      return
    }
    save.mutate(edits)
  }

  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      publishColumnRequest(id, published),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  // Опубликовать колонку с несохранёнными баллами — значит показать студентам пустую
  // или устаревшую: сначала «Сохранить».
  function onPublish(col: GradeColumnItem) {
    if (!col.published && hasEditsIn(col.id)) {
      toast.error(t('publishUnsaved'))
      return
    }
    publish.mutate({ id: col.id, published: !col.published })
  }

  const removeCol = useMutation({
    mutationFn: (id: string) => deleteColumnRequest(id),
    onSuccess: (_, id) => {
      // Правки удалённой колонки сохранять больше некуда.
      setEdits((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${id}|`))),
      )
      invalidate()
      toast.success(t('columnDeleted'))
    },
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'CONFLICT' ? t('deleteColumnPublished') : tErr(code))
    },
  })

  // Порядок колонок — `position`. После удалений номера бывают с дырами и повторами
  // (новая колонка получает номер по их числу), поэтому сдвиг перенумеровывает журнал
  // по новому порядку целиком, а на сервер уходят только изменившиеся номера.
  const move = useMutation({
    mutationFn: async ({ id, by }: { id: string; by: -1 | 1 }) => {
      const order = [...(q.data?.columns ?? [])]
      const from = order.findIndex((c) => c.id === id)
      const to = from + by
      if (from < 0 || to < 0 || to >= order.length) return
      const [col] = order.splice(from, 1)
      if (col) order.splice(to, 0, col)
      await Promise.all(
        order.map((c, i) => (c.position === i ? null : updateColumnRequest(c.id, { position: i }))),
      )
    },
    onSettled: () => invalidate(),
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

  // Итог числом — на нём же строится сортировка по колонке «Итого».
  const totalPct = useMemo(() => {
    const cols = q.data?.columns ?? []
    return (studentId: string): number | null => {
      const scored = cols
        .map((c) => {
          const raw = values[cellKey(c.id, studentId)]
          if (raw === undefined || raw === '' || c.maxScore == null) return null
          const n = Number(raw)
          return Number.isNaN(n) ? null : n / c.maxScore
        })
        .filter((x): x is number => x !== null)
      if (scored.length === 0) return null
      return Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100)
    }
  }, [q.data?.columns, values])
  const total = (studentId: string): string | null => {
    const pct = totalPct(studentId)
    return pct === null ? null : `${pct}%`
  }

  // Считает по ЧЕРНОВИКУ (values), поэтому только что проставленный балл сразу меняет
  // порядок — сортировать по сохранённому значению во время заполнения бессмысленно.
  const sortValue = useCallback(
    (s: GradebookStudent, key: string): unknown =>
      key === 'total' ? totalPct(s.id) : `${s.lastName} ${s.firstName}`,
    [totalPct],
  )

  // Хук до ранних выходов: порядок хуков не должен зависеть от состояния запроса.
  // Сортировка здесь клиентская намеренно: это не список, а матрица «студенты × колонки»
  // одного курса — сервер отдаёт её целиком одним ответом, страниц нет. Серверный порядок
  // означал бы сортировку по значению произвольной колонки оценок, чего в контракте нет.
  const { rows: sortedStudents, sort, toggle } = useTableSort(q.data?.students ?? [], sortValue)

  const columns = q.data?.columns ?? []
  const students = q.data?.students ?? []

  const columnMenu = (col: GradeColumnItem, index: number) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" icon aria-label={t('columnActions')}>
          <MoreHorizontal className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setEditing(col)}>
          <Pencil aria-hidden />
          {t('editColumn')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === 0 || move.isPending}
          onClick={() => move.mutate({ id: col.id, by: -1 })}
        >
          <ArrowLeft aria-hidden />
          {t('moveLeft')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === columns.length - 1 || move.isPending}
          onClick={() => move.mutate({ id: col.id, by: 1 })}
        >
          <ArrowRight aria-hidden />
          {t('moveRight')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPublish(col)}>
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

  return (
    // `min-h-0` — только под таблицу: матрица прокручивается внутри себя и обязана
    // получить высоту от корня (§10.7). На мобильной вёрстке вместо неё список карточек,
    // и там прокручивается страница — с `min-h-0` он был бы обрезан по низу экрана.
    <div className={cn('flex w-full flex-1 flex-col gap-4', isDesktop && 'min-h-0')}>
      <PageHeader
        title={t('title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {courseSelect}
            <Button size="md" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              {t('addColumn')}
            </Button>
            <Button
              size="md"
              className="gap-1.5"
              onClick={onSave}
              loading={save.isPending}
              disabled={dirtyCount === 0}
            >
              <Save className="size-4" aria-hidden />
              {t('save')}
            </Button>
          </div>
        }
      />

      {q.isLoading ? (
        <Skeleton fill className="min-h-80 rounded-xl" />
      ) : columns.length === 0 ? (
        <EmptyState icon={<Plus />} title={t('noColumns')} description={t('noColumnsHint')} />
      ) : isDesktop ? (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          {/* Матрица «студенты × колонки»: шапка липнет к верху, первая колонка — к левому
              краю, поэтому при любом скролле видно, чья оценка и в какую колонку.
              Высоту даёт карточка (`flex-1`), а не `max-h-*`: журнал доходит до низа
              области контента, и последняя строка не обрезается на середине. */}
          <TableScroll className="max-h-none min-h-0 flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    sortKey="student"
                    sort={sort}
                    onSort={toggle}
                    className="sticky left-0 z-20 px-3"
                  >
                    {t('student')}
                  </TableHead>
                  {columns.map((col, index) => (
                    <TableHead key={col.id} className="px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="truncate">{col.title}</span>
                        {columnMenu(col, index)}
                      </div>
                      <div className="flex items-center justify-center gap-1 text-[11px] font-normal">
                        {col.maxScore != null && <span>/{col.maxScore}</span>}
                        {!col.published && <Badge variant="secondary">{t('draft')}</Badge>}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead numeric sortKey="total" sort={sort} onSort={toggle} className="px-3">
                    {t('total')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStudents.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="sticky left-0 z-10 truncate bg-card px-3 py-1.5 font-medium">
                      {s.lastName} {s.firstName[0]}.
                    </TableCell>
                    {columns.map((col) => {
                      const raw = values[cellKey(col.id, s.id)]
                      const bad = isOutOfRange(col, raw)
                      return (
                        <TableCell key={col.id} className="px-2 py-1.5 text-center">
                          <Input
                            type="number"
                            value={raw ?? ''}
                            onChange={(e) => setCell(col.id, s.id, e.target.value)}
                            className={cn(
                              'mx-auto h-8 w-16 px-2 text-center',
                              !col.published && 'bg-muted/40',
                            )}
                            min={0}
                            max={ceilingOf(col)}
                            aria-invalid={bad || undefined}
                            title={bad ? t('cellOutOfRange', { max: ceilingOf(col) }) : undefined}
                          />
                        </TableCell>
                      )
                    })}
                    <TableCell className="px-3 py-1.5 text-center font-semibold tabular-nums">
                      {total(s.id) ?? <TableEmpty />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
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
      {editing && (
        <AddColumnModal courseId={courseId} column={editing} onClose={() => setEditing(null)} />
      )}
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
  // null — ни одна работа не оценена: в карточке это «пусто», а не прочерк.
  total: string | null
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
            <span className="text-sm font-semibold tabular-nums text-primary">
              {total ?? <TableEmpty />}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {columns.map((col) => {
              const raw = values[cellKey(col.id, student.id)]
              const bad = isOutOfRange(col, raw)
              return (
                <div key={col.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
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
                      value={raw ?? ''}
                      onChange={(e) => setCell(col.id, student.id, e.target.value)}
                      className="h-8 w-20 text-center"
                      min={0}
                      max={ceilingOf(col)}
                      aria-invalid={bad || undefined}
                    />
                  </div>
                  {/* На карточке есть место под строку ошибки — в таблице её заменяет подсказка. */}
                  <FieldError className="text-right">
                    {bad ? t('cellOutOfRange', { max: ceilingOf(col) }) : null}
                  </FieldError>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </li>
  )
}
