'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import {
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

// Имя забирает остаток ширины: остальные колонки — под конкретный контрол.
// «Статус» — под самую длинную подпись («Запланирован»), «Балл» — под трёхзначное
// число со стрелками числового поля: у́же placeholder обрезался до «Бал».
const COLS = ['auto', '6rem', '13rem', '7rem'] as const

// Ведомость экзамена: допуск + статус + балл по каждому студенту (декан/экзаменатор).
export function ExamResultsRoster({ examId, onBack }: { examId: string; onBack: () => void }) {
  const t = useTranslations('Exams')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: examKeys.results(examId),
    queryFn: () => fetchExamResults(examId),
  })
  const [rows, setRows] = useState<Record<string, Row>>({})

  useEffect(() => {
    if (!q.data) return
    setRows(
      Object.fromEntries(
        q.data.students.map((s) => [
          s.studentId,
          { admitted: s.admitted, status: s.status, score: s.score != null ? String(s.score) : '' },
        ]),
      ),
    )
  }, [q.data])

  const save = useMutation({
    mutationFn: () => {
      const entries = Object.entries(rows).map(([studentId, r]) => ({
        studentId,
        admitted: r.admitted,
        status: r.status,
        score: r.score === '' ? null : Number(r.score),
      }))
      return setExamResultsRequest({ examId, entries })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: examKeys.results(examId) })
      qc.invalidateQueries({ queryKey: examKeys.all })
      toast.success(t('resultsSaved'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const patch = (id: string, p: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...p } }))

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
            onClick={() => save.mutate()}
            loading={save.isPending}
          >
            <Save className="size-4" aria-hidden />
            {t('save')}
          </Button>
        }
      />

      {q.isLoading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
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
                return (
                  <TableRow key={s.studentId}>
                    <TableCell className="font-medium">
                      <TableText value={name} />
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
                        <SelectTrigger size="md" aria-label={`${t('colStatus')}: ${name}`}>
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
                        aria-label={`${t('scoreShort')}: ${name}`}
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
