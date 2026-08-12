'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CheckCheck, QrCode, Save } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import {
  attendanceKeys,
  fetchRoster,
  markAttendanceRequest,
  type AttendanceStatus,
} from '../../../entities/attendance'
import { ATT_ACTIVE, ATT_KEY, ATTENDANCE_ORDER, ATT_SHORT_KEY } from '../lib/status-visuals'
import { AttendanceQrModal } from './attendance-qr-modal'

interface Props {
  pairId: string
  date: string
  onBack: () => void
}

// Ростер занятия: отметка посещаемости. «Отметить всех присутствующими» + правка исключений.
export function AttendanceRoster({ pairId, date, onBack }: Props) {
  const t = useTranslations('Attendance')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: attendanceKeys.roster(pairId, date),
    queryFn: () => fetchRoster(pairId, date),
  })

  const [marks, setMarks] = useState<Record<string, AttendanceStatus | null>>({})
  const [qrOpen, setQrOpen] = useState(false)

  useEffect(() => {
    if (q.data) {
      setMarks(Object.fromEntries(q.data.students.map((s) => [s.studentId, s.status])))
    }
  }, [q.data])

  const save = useMutation({
    mutationFn: () => {
      const entries = Object.entries(marks)
        .filter(([, status]) => status !== null)
        .map(([studentId, status]) => ({ studentId, status: status as AttendanceStatus }))
      return markAttendanceRequest({ pairId, date, entries })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: attendanceKeys.roster(pairId, date) })
      toast.success(t('saved'))
    },
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  function markAllPresent() {
    setMarks((prev) => {
      const next = { ...prev }
      for (const id of Object.keys(next)) next[id] = 'PRESENT'
      return next
    })
  }

  const marked = Object.values(marks).filter((s) => s !== null).length

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        title={q.data?.subject ?? t('title')}
        subtitle={date}
        onBack={onBack}
        backLabel={t('back')}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setQrOpen(true)}>
              <QrCode className="size-4" aria-hidden />
              {t('qrButton')}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={markAllPresent}>
              <CheckCheck className="size-4" aria-hidden />
              {t('markAllPresent')}
            </Button>
          </div>
        }
      />

      {qrOpen && <AttendanceQrModal pairId={pairId} date={date} onClose={() => setQrOpen(false)} />}

      {q.isLoading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {(q.data?.students ?? []).map((s) => (
                <li key={s.studentId} className="flex items-center gap-3 p-2.5">
                  <Avatar className="size-8">
                    <AvatarImage src={s.avatarUrl ?? undefined} alt="" />
                    <AvatarFallback>
                      {s.firstName[0]}
                      {s.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {s.lastName} {s.firstName}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    {ATTENDANCE_ORDER.map((st) => (
                      <button
                        key={st}
                        type="button"
                        aria-label={t(ATT_KEY[st])}
                        title={t(ATT_KEY[st])}
                        onClick={() => setMarks((prev) => ({ ...prev, [s.studentId]: st }))}
                        className={cn(
                          'flex size-8 items-center justify-center rounded-lg text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted',
                          marks[s.studentId] === st && ATT_ACTIVE[st],
                        )}
                      >
                        {t(ATT_SHORT_KEY[st])}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {t('markedCount', { n: marked, total: q.data?.students.length ?? 0 })}
        </span>
        <Button className="gap-1.5" onClick={() => save.mutate()} loading={save.isPending}>
          <Save className="size-4" aria-hidden />
          {t('save')}
        </Button>
      </div>
    </div>
  )
}
