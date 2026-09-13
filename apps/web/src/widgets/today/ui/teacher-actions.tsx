'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  Plus,
  Table2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge, Button, EmptyState, SectionPanel, Skeleton } from '../../../shared/ui'
import { attendanceKeys, fetchMarkedPairs } from '../../../entities/attendance'
import { assignmentKeys, fetchReviewQueue } from '../../../entities/assignment'
import { consultationKeys, fetchMyConsultations } from '../../../entities/consultation'
import type { DayPair, NowInTz } from '../lib/schedule-day'

/**
 * Панели дашборда преподавателя, отвечающие на вопрос «что я должен сделать».
 *
 * Расписание и уведомления говорят, что происходит; обязанности со сроком — нет.
 * Их две: отметить посещаемость на проведённых сегодня парах и проверить сданные
 * работы. Обе раньше были не видны, пока не зайдёшь в раздел и не откроешь каждую
 * пару или каждое задание по очереди.
 */

const REVIEW_LIMIT = 5
const CONSULTATIONS_LIMIT = 3

/** Пары сегодня, по которым журнал ещё не заполнен. */
export function AttendanceTodoPanel({
  dayPairs,
  date,
  now,
}: {
  dayPairs: DayPair[]
  date: string
  now: NowInTz
}) {
  const t = useTranslations('Today')

  // Отмечать имеет смысл НАЧАВШИЕСЯ пары: журнал будущей заполнять нечем, и она
  // висела бы в «требует действия» с самого утра.
  //
  // Сравниваем время, а не `state`: признак `past`/`now` проставляется только парам
  // без изменений — у перенесённой или заменённой он остаётся `moved`/`substituted`
  // даже после её окончания, и она бы в список не попала.
  const started = useMemo(
    () =>
      dayPairs.filter(
        (dp) =>
          dp.state !== 'cancelled' && now.time >= (dp.change?.newStartTime ?? dp.pair.startTime),
      ),
    [dayPairs, now.time],
  )
  const pairIds = useMemo(() => started.map((dp) => dp.pair.id), [started])

  const marked = useQuery({
    queryKey: attendanceKeys.marked(date, pairIds),
    queryFn: () => fetchMarkedPairs(date, pairIds),
    enabled: pairIds.length > 0,
  })

  const pending = started.filter((dp) => !(marked.data ?? []).includes(dp.pair.id))

  return (
    <SectionPanel title={t('attendanceTodo')} subtitle={t('attendanceTodoHint')}>
      {pairIds.length > 0 && marked.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-6" aria-hidden />}
          title={t('attendanceAllMarked')}
          className="border-0 p-6"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((dp) => (
            <li key={dp.pair.id}>
              <Link
                href="/teacher/attendance"
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {dp.change?.newStartTime ?? dp.pair.startTime}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {dp.pair.subject}
                </span>
                <Badge variant="warning">{t('attendanceNotMarked')}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  )
}

/** Сданные работы, ожидающие оценки. */
export function ReviewQueuePanel() {
  const t = useTranslations('Today')
  const q = useQuery({
    queryKey: assignmentKeys.reviewQueue(REVIEW_LIMIT),
    queryFn: () => fetchReviewQueue(REVIEW_LIMIT),
  })

  const items = q.data?.items ?? []

  return (
    <SectionPanel
      title={t('reviewQueue')}
      subtitle={t('reviewQueueHint')}
      actions={
        q.data && q.data.total > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link href="/teacher/assignments">{t('reviewOpenAll', { count: q.data.total })}</Link>
          </Button>
        ) : null
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="size-6" aria-hidden />}
          title={t('reviewEmpty')}
          className="border-0 p-6"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/teacher/assignments/${a.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.title}</span>
                  {a.subject && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.subject}
                    </span>
                  )}
                </span>
                {/* Число — сам предмет работы, поэтому цифрой, а не длиной полосы. */}
                <Badge variant="info">{a.pending}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  )
}

/**
 * Быстрые действия: четыре перехода, которыми преподаватель начинает день.
 * Это не дубль сайдбара — в сайдбаре разделы, здесь конкретные операции, и они
 * стоят рядом с тем, что о них сообщает.
 */
const QUICK: { key: string; href: string; icon: LucideIcon }[] = [
  { key: 'quickAttendance', href: '/teacher/attendance', icon: ClipboardCheck },
  { key: 'quickNewAssignment', href: '/teacher/assignments', icon: Plus },
  { key: 'quickGradebook', href: '/teacher/gradebook', icon: Table2 },
  { key: 'quickMaterials', href: '/teacher/materials', icon: ClipboardList },
]

export function TeacherQuickActions() {
  const t = useTranslations('Today')
  return (
    <SectionPanel title={t('quickActions')} subtitle={t('quickActionsHint')}>
      <div className="grid grid-cols-2 gap-2">
        {QUICK.map((a) => {
          const Icon = a.icon
          return (
            <Button key={a.key} asChild variant="outline" className="justify-start gap-2">
              <Link href={a.href}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t(a.key)}</span>
              </Link>
            </Button>
          )
        })}
      </div>
    </SectionPanel>
  )
}

/**
 * Ближайшие записи студентов на консультацию.
 *
 * `from` обязателен: список отсортирован по возрастанию времени, и без фильтра его
 * первая страница — самые СТАРЫЕ слоты, то есть прошлогодние. Сортировка по убыванию
 * тут не помогает: «ближайшие» и «последние прошедшие» — разные вопросы.
 */
export function UpcomingConsultationsPanel() {
  const t = useTranslations('Today')
  const locale = useLocale()
  // Момент запроса фиксируем один раз на монтирование: в ключе кэша он не должен
  // меняться каждую секунду, иначе запрос уходит на каждый рендер.
  const from = useMemo(() => new Date().toISOString(), [])
  const query = useMemo(
    () => ({
      page: 1,
      limit: CONSULTATIONS_LIMIT,
      sort: 'startsAt' as const,
      order: 'asc' as const,
      from,
    }),
    [from],
  )

  const q = useQuery({
    queryKey: consultationKeys.mine(query),
    queryFn: () => fetchMyConsultations(query),
  })

  const items = (q.data?.items ?? []).filter((s) => s.status === 'BOOKED')

  return (
    <SectionPanel title={t('consultationsNext')} subtitle={t('consultationsNextHint')}>
      {q.isPending ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" aria-hidden />}
          title={t('consultationsEmpty')}
          className="border-0 p-6"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <li key={s.id}>
              <Link
                href="/teacher/consultations"
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {new Date(s.startsAt).toLocaleString(locale, {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {s.student
                    ? `${s.student.lastName} ${s.student.firstName}`
                    : t('consultationsFree')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  )
}
