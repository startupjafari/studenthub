'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { GraduationCap, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SegmentedTabs,
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
import { examKeys, fetchExams, type ExamItem } from '../../../entities/exam'
import { EXAM_STATUS_BADGE, EXAM_STATUS_KEY, examFormatKey } from '../lib/visuals'

type TabId = 'upcoming' | 'past'
const TAB_ORDER: TabId[] = ['upcoming', 'past']

// Дисциплина · формат · дата · аудитория · экзаменатор · допуск · балл · статус.
const COLS = ['22%', '10%', '11rem', '7rem', '14%', '8rem', '6rem', '9rem'] as const
// До `md` остаются дисциплина, дата, балл и статус — по ним сессию и читают.
const COLS_NARROW = ['40%', '0', '24%', '0', '0', '0', '16%', '20%'] as const
const HIDE = {
  format: 'hidden lg:table-cell',
  room: 'hidden xl:table-cell',
  examiner: 'hidden xl:table-cell',
  admission: 'hidden md:table-cell',
} as const
// Порядок классов = порядок колонок: скелетон прячет те же, что и шапка.
const SKELETON_COLS = [
  undefined,
  HIDE.format,
  undefined,
  HIDE.room,
  HIDE.examiner,
  HIDE.admission,
  undefined,
  undefined,
]

// Экзамены и сессия студента (задача 11): разделы «предстоящие/прошедшие» в шапке,
// таблица с сортировкой на клиенте — весь список приходит одним запросом.
export function StudentExamsView() {
  const t = useTranslations('Exams')
  const locale = useLocale()
  const [tab, setTab] = useState<TabId>('upcoming')
  const q = useQuery({ queryKey: examKeys.list(), queryFn: () => fetchExams() })

  const now = Date.now()
  const grouped = useMemo(() => {
    const list = q.data ?? []
    const time = (e: ExamItem): number => new Date(e.date).getTime()
    return {
      // Предстоящие — ближайший сверху, прошедшие — свежий сверху: до нажатия на
      // заголовок таблица показывает то, что ближе всего к сегодняшнему дню.
      upcoming: list.filter((e) => time(e) >= now).sort((a, b) => time(a) - time(b)),
      past: list.filter((e) => time(e) < now).sort((a, b) => time(b) - time(a)),
    }
  }, [q.data, now])

  const current = grouped[tab]

  // Сортировка клиентская: список экзаменов приходит целиком, серверу пересортировывать
  // нечего. Статус и допуск сравниваем по переводу — алфавит языка интерфейса.
  const sortValue = useCallback(
    (e: ExamItem, key: string) => {
      const r = e.myResult
      switch (key) {
        case 'format':
          return t(examFormatKey(e.format))
        case 'date':
          return new Date(e.date).getTime()
        case 'room':
          return e.room?.name ?? null
        case 'examiner':
          return e.examiner ? `${e.examiner.lastName} ${e.examiner.firstName}` : null
        case 'admission':
          return r ? (r.admitted ? t('admitted') : t('notAdmitted')) : t('admissionPending')
        case 'score':
          return r?.score ?? null
        case 'status':
          return r ? t(EXAM_STATUS_KEY[r.status]) : null
        default:
          return e.course.subject.name
      }
    },
    [t],
  )
  // Без начальной сортировки: порядок задаёт вкладка (см. `grouped`).
  const { rows, sort, toggle } = useTableSort(current, sortValue)

  const isEmpty = (q.data ?? []).length === 0

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('myTitle')}
        // Разделы — в шапке рядом с заголовком, как на остальных экранах со вкладками.
        tabs={
          <SegmentedTabs
            aria-label={t('myTitle')}
            value={tab}
            onChange={setTab}
            items={TAB_ORDER.map((id) => ({
              value: id,
              label: t(id),
              count: grouped[id].length,
            }))}
          />
        }
      />

      {q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : !q.isLoading && isEmpty ? (
        <EmptyState icon={<GraduationCap />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы
        // и просвет под последней строкой — таблица занимает карточку целиком.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="subject" sort={sort} onSort={toggle}>
                  {t('colSubject')}
                </TableHead>
                <TableHead sortKey="format" sort={sort} onSort={toggle} className={HIDE.format}>
                  {t('format')}
                </TableHead>
                <TableHead sortKey="date" sort={sort} onSort={toggle}>
                  {t('colDate')}
                </TableHead>
                <TableHead sortKey="room" sort={sort} onSort={toggle} className={HIDE.room}>
                  {t('colRoom')}
                </TableHead>
                <TableHead sortKey="examiner" sort={sort} onSort={toggle} className={HIDE.examiner}>
                  {t('colExaminer')}
                </TableHead>
                <TableHead
                  sortKey="admission"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.admission}
                >
                  {t('admittedShort')}
                </TableHead>
                <TableHead numeric sortKey="score" sort={sort} onSort={toggle}>
                  {t('scoreShort')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('colStatus')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((e) => {
                const r = e.myResult
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <TableText value={e.course.subject.name} />
                    </TableCell>
                    <TableCell className={cn(HIDE.format, 'text-muted-foreground')}>
                      <TableText value={t(examFormatKey(e.format))} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {new Date(e.date).toLocaleString(locale, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className={cn(HIDE.room, 'text-muted-foreground')}>
                      <TableText value={e.room?.name} />
                    </TableCell>
                    <TableCell className={cn(HIDE.examiner, 'text-muted-foreground')}>
                      <TableText
                        value={
                          e.examiner ? `${e.examiner.lastName} ${e.examiner.firstName}` : undefined
                        }
                      />
                    </TableCell>
                    <TableCell className={HIDE.admission}>
                      {r ? (
                        <Badge variant={r.admitted ? 'success' : 'destructive'}>
                          {r.admitted ? t('admitted') : t('notAdmitted')}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{t('admissionPending')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {r?.score != null ? (
                        `${r.score}${e.maxScore != null ? ` / ${e.maxScore}` : ''}`
                      ) : (
                        <TableEmpty />
                      )}
                    </TableCell>
                    <TableCell>
                      {r ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={EXAM_STATUS_BADGE[r.status]}>
                            {t(EXAM_STATUS_KEY[r.status])}
                          </Badge>
                          {/* Повторная попытка — та же строка, но это уже пересдача. */}
                          {r.attempt > 1 && (
                            <Badge variant="info">{t('attemptN', { n: r.attempt })}</Badge>
                          )}
                        </span>
                      ) : (
                        <TableEmpty />
                      )}
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
