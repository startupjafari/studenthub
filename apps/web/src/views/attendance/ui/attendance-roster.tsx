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
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { toApiError } from '../../../shared/lib'
import {
  attendanceKeys,
  fetchRoster,
  markAttendanceRequest,
  type AttendanceStatus,
  type RosterEntry,
} from '../../../entities/attendance'
import { ATT_ACTIVE, ATT_KEY, ATTENDANCE_ORDER, ATT_SHORT_KEY } from '../lib/status-visuals'
import { AttendanceQrModal } from './attendance-qr-modal'

interface Props {
  pairId: string
  date: string
  onBack: () => void
}

// Имя забирает остаток ширины; вторая колонка — ровно под четыре кнопки отметки
// (4 × 2.25rem + 3 × 0.25rem) плюс отступы ячейки.
const COLS = ['auto', '13rem'] as const

// Ростер занятия: отметка посещаемости. «Отметить всех присутствующими» + правка исключений.
//
// Таблица, а не список строк: в группе до тридцати студентов, и шапка на `sticky` держит
// подписи колонок при прокрутке — видно, что за столбик кнопок под курсором. Сортировка
// по отметке собирает неотмеченных вместе: ими заканчивают заполнение.
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

  /*
    Сортируем по ЧЕРНОВИКУ (`marks`), а не по ответу сервера: иначе поставленная отметка
    не влияла бы на порядок до сохранения, и «неотмеченные сверху» не работало бы ровно
    тогда, когда это нужно — во время заполнения. Сортировки по умолчанию нет: ростер
    приходит по алфавиту, и стрелка в шапке означала бы выбор, которого не делали.
  */
  const roster = q.data?.students ?? []
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<RosterEntry>(roster, (s, key) => {
    if (key === 'name') return `${s.lastName} ${s.firstName}`
    if (key === 'mark') {
      const st = marks[s.studentId] ?? s.status
      // Неотмеченные — отдельное значение перед всеми статусами, а не «пусто»:
      // так первый клик по колонке собирает их в начало.
      return st === null ? -1 : ATTENDANCE_ORDER.indexOf(st)
    }
    return null
  })

  const marked = Object.values(marks).filter((s) => s !== null).length

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
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

      <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
        {/*
          Прокрутка внутри тела таблицы, без страниц: ростер заполняют сверху вниз за один
          проход, и разбиение на страницы означало бы «сохранить» посреди группы.
        */}
        <Table fixed scrollBody fill cols={COLS}>
          <TableHeader>
            <TableRow>
              <TableHead sortKey="name" sort={sort} onSort={toggle}>
                {t('colStudent')}
              </TableHead>
              {/* `numeric` здесь — про выравнивание, а не про числа: заголовок
                  сортируемой колонки это кнопка `flex w-full`, и `text-right`
                  у ячейки на неё не действует (см. `TableHead`). */}
              <TableHead numeric sortKey="mark" sort={sort} onSort={toggle}>
                {t('colMark')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading && <TableSkeletonRows columns={2} />}
            {sorted.map((s) => {
              const name = `${s.lastName} ${s.firstName}`
              return (
                <TableRow key={s.studentId}>
                  <TableCell className="font-medium">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-9 shrink-0">
                        <AvatarImage src={s.avatarUrl ?? undefined} alt="" />
                        <AvatarFallback>
                          {s.firstName[0]}
                          {s.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <TableText value={name} />
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {ATTENDANCE_ORDER.map((st) => (
                        <button
                          key={st}
                          type="button"
                          // Подписи у кнопки нет — её несёт заголовок колонки, но
                          // скринридеру нужно имя студента, иначе все кнопки одинаковы.
                          aria-label={`${t(ATT_KEY[st])}: ${name}`}
                          aria-pressed={marks[s.studentId] === st}
                          title={t(ATT_KEY[st])}
                          onClick={() => setMarks((prev) => ({ ...prev, [s.studentId]: st }))}
                          className={cn(
                            'flex size-9 items-center justify-center rounded-lg text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted',
                            marks[s.studentId] === st && ATT_ACTIVE[st],
                          )}
                        >
                          {t(ATT_SHORT_KEY[st])}
                        </button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

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
