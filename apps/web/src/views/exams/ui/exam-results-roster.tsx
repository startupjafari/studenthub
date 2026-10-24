'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  examKeys,
  fetchExamResults,
  setExamResultsRequest,
  type ExamResultStatus,
  type ExamRosterEntry,
} from '../../../entities/exam'
import { EXAM_STATUS_KEY, EXAM_STATUS_ORDER } from '../lib/visuals'

interface Row {
  admitted: boolean
  status: ExamResultStatus
  score: string
}

// Общий потолок схемы (SetExamResultsSchema): действует, когда у экзамена нет максимума.
const SCORE_CEILING = 1000

/**
 * Ошибки строки ведомости — те же, что проверяет сервер: балл вне 0..максимум и «сдал»
 * или «не сдал» у недопущенного. Подсветка сразу при вводе дешевле отказа всей ведомости.
 */
function rowErrors(r: Row, ceiling: number): { score: boolean; status: boolean } {
  const n = Number(r.score)
  return {
    score: r.score !== '' && (Number.isNaN(n) || n < 0 || n > ceiling),
    status: !r.admitted && (r.status === 'PASSED' || r.status === 'FAILED'),
  }
}

// Имя забирает остаток ширины: остальные колонки — под конкретный контрол.
// «Статус» — под самую длинную подпись («Запланирован»), «Балл» — под трёхзначное
// число со стрелками числового поля: у́же placeholder обрезался до «Бал».
const COLS = ['auto', '6rem', '13rem', '7rem'] as const

// Ведомость экзамена: допуск + статус + балл по каждому студенту (декан/экзаменатор).
export function ExamResultsRoster({
  examId,
  maxScore,
  onBack,
}: {
  examId: string
  /** Максимум экзамена; null — действует только общий потолок схемы. */
  maxScore: number | null
  onBack: () => void
}) {
  const t = useTranslations('Exams')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: examKeys.results(examId),
    queryFn: () => fetchExamResults(examId),
  })
  const [rows, setRows] = useState<Record<string, Row>>({})
  // Тронутые строки (studentId). На сохранение уходят только они: ведомость целиком
  // молча затирала результаты, выставленные вторым проверяющим после её открытия, —
  // нетронутая у нас пустая строка уходила как «запланирован, без балла». Ref — для
  // слияния с перечитанной ведомостью, чтобы эффект не зависел от черновика.
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const ceiling = maxScore ?? SCORE_CEILING

  // Ответ сервера переписывает только нетронутые строки: правки, ещё не сохранённые,
  // переживают перечитывание ведомости.
  useEffect(() => {
    if (!q.data) return
    const students = q.data.students
    setRows((prev) =>
      Object.fromEntries(
        students.map((s) => {
          const draft = prev[s.studentId]
          if (draft && dirtyRef.current.has(s.studentId)) return [s.studentId, draft]
          return [
            s.studentId,
            {
              admitted: s.admitted,
              status: s.status,
              score: s.score != null ? String(s.score) : '',
            },
          ]
        }),
      ),
    )
  }, [q.data])

  const save = useMutation({
    mutationFn: (ids: string[]) => {
      const entries = ids.flatMap((studentId) => {
        const r = rows[studentId]
        return r
          ? [
              {
                studentId,
                admitted: r.admitted,
                status: r.status,
                score: r.score === '' ? null : Number(r.score),
              },
            ]
          : []
      })
      return setExamResultsRequest({ examId, entries })
    },
    onSuccess: (_data, ids) => {
      // Снимаем отметку только с отправленных строк: тронутое во время запроса — ещё черновик.
      setDirty((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
      qc.invalidateQueries({ queryKey: examKeys.results(examId) })
      qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(t('resultsSaved'))
    },
    onError: (e) => {
      const code = toApiError(e).code
      toast.error(code === 'VALIDATION_ERROR' ? t('rosterInvalid') : tErr(code))
    },
  })

  // Ведомость с ошибками не отправляем: сервер отклонил бы её целиком, а поля и так
  // подсвечены.
  function onSave() {
    const ids = [...dirty]
    if (ids.length === 0) return
    const invalid = ids.some((id) => {
      const r = rows[id]
      if (!r) return false
      const err = rowErrors(r, ceiling)
      return err.score || err.status
    })
    if (invalid) {
      toast.error(t('rosterInvalid'))
      return
    }
    save.mutate(ids)
  }

  const patch = (id: string, p: Partial<Row>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...p } }))
    setDirty((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  /*
    Сортировка на фронте: ведомость приходит целиком, страниц нет — сортировать на
    сервере значило бы гонять запрос ради порядка строк, который уже весь в памяти.
    Сортируем по ЧЕРНОВИКУ (rows), а не по ответу сервера: иначе поставленный балл
    не влиял бы на порядок до сохранения, и «показать несданных сверху» не работало бы
    ровно тогда, когда это нужно — во время заполнения.
  */
  const roster = q.data?.students ?? []
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<ExamRosterEntry>(roster, (s, key) => {
    const draft = rows[s.studentId]
    if (key === 'name') return `${s.lastName} ${s.firstName}`
    if (key === 'admitted') return (draft?.admitted ?? s.admitted) ? 1 : 0
    if (key === 'status') return EXAM_STATUS_ORDER.indexOf(draft?.status ?? s.status)
    if (key === 'score') {
      const raw = draft?.score
      return raw === undefined ? s.score : raw === '' ? null : Number(raw)
    }
    return null
  })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('roster')}
        onBack={onBack}
        backLabel={t('back')}
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={onSave}
            loading={save.isPending}
            disabled={dirty.size === 0}
          >
            <Save className="size-4" aria-hidden />
            {t('save')}
          </Button>
        }
      />

      {q.isLoading ? (
        <Skeleton fill className="min-h-80 rounded-xl" />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          {/*
            Прокрутка внутри тела таблицы, без страниц: ведомость заполняют сверху вниз
            за один проход, и разбиение на страницы означало бы «сохранить» посреди
            группы. Шапка при этом остаётся на месте — видно, какая колонка под курсором.
          */}
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={toggle}>
                  {t('colStudent')}
                </TableHead>
                <TableHead sortKey="admitted" sort={sort} onSort={toggle}>
                  {t('admittedShort')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('colStatus')}
                </TableHead>
                <TableHead numeric sortKey="score" sort={sort} onSort={toggle}>
                  {t('scoreShort')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((s) => {
                const r = rows[s.studentId]
                if (!r) return null
                const name = `${s.lastName} ${s.firstName}`
                const err = rowErrors(r, ceiling)
                return (
                  <TableRow key={s.studentId}>
                    <TableCell className="font-medium">
                      {/* Попытка растёт, когда «Пересдача» получает итог (C-F10): экзаменатор
                          видит, что в строке уже результат пересдачи, а не первой попытки. */}
                      <span className="flex min-w-0 items-center gap-2">
                        <TableText value={name} className="min-w-0" />
                        {s.attempt > 1 && (
                          <Badge variant="info" className="shrink-0">
                            {t('attemptN', { n: s.attempt })}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {/* Подписи у флажка нет — её несёт заголовок колонки, но
                          скринридеру нужно имя студента, иначе все флажки одинаковы. */}
                      <Checkbox
                        checked={r.admitted}
                        aria-label={`${t('admittedShort')}: ${name}`}
                        onCheckedChange={(v) => patch(s.studentId, { admitted: v === true })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.status}
                        onValueChange={(v) => patch(s.studentId, { status: v as ExamResultStatus })}
                      >
                        <SelectTrigger
                          size="md"
                          aria-label={`${t('colStatus')}: ${name}`}
                          aria-invalid={err.status || undefined}
                          title={err.status ? t('notAdmittedStatus') : undefined}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXAM_STATUS_ORDER.map((st) => (
                            <SelectItem key={st} value={st}>
                              {t(EXAM_STATUS_KEY[st])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={r.score}
                        onChange={(e) => patch(s.studentId, { score: e.target.value })}
                        size="md"
                        className="text-center"
                        min={0}
                        max={ceiling}
                        aria-label={`${t('scoreShort')}: ${name}`}
                        aria-invalid={err.score || undefined}
                        title={err.score ? t('scoreOutOfRange', { max: ceiling }) : undefined}
                        placeholder={t('scoreShort')}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
