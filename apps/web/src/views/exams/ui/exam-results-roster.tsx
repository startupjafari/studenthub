'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'
import {
  examKeys,
  fetchExamResults,
  setExamResultsRequest,
  type ExamResultStatus,
} from '../../../entities/exam'
import { EXAM_STATUS_KEY, EXAM_STATUS_ORDER } from '../lib/visuals'

interface Row {
  admitted: boolean
  status: ExamResultStatus
  score: string
}

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

  return (
    <div className="flex w-full flex-col gap-5">
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
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {(q.data?.students ?? []).map((s) => {
                const r = rows[s.studentId]
                if (!r) return null
                return (
                  <li
                    key={s.studentId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {s.lastName} {s.firstName}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={r.admitted}
                        onCheckedChange={(v) => patch(s.studentId, { admitted: v === true })}
                      />
                      {t('admittedShort')}
                    </label>
                    <div className="w-36">
                      <Select
                        value={r.status}
                        onValueChange={(v) => patch(s.studentId, { status: v as ExamResultStatus })}
                      >
                        <SelectTrigger className="h-9">
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
                    </div>
                    <Input
                      type="number"
                      value={r.score}
                      onChange={(e) => patch(s.studentId, { score: e.target.value })}
                      className="h-9 w-20 text-center"
                      placeholder={t('scoreShort')}
                    />
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
