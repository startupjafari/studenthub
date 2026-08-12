import type { Pair, ScheduleChange } from '../../../entities/schedule'
import type { EventItem } from '../../../entities/event'
import type { AssignmentItem } from '../../../entities/assignment'
import { isoWeekParity } from '../../../shared/lib'
import { formatYmd, pad } from '../../../shared/ui/calendar-grid'

// Единый академический календарь (задача 9): пары (разворачиваются из недельного
// шаблона на конкретные даты), события, изменения расписания — в одной модели.
// Задания/экзамены/консультации подключатся со своими доменами.

export type CalItemType = 'pair' | 'event' | 'assignment'

export interface CalItem {
  id: string
  date: string // YYYY-MM-DD
  start: string | null // HH:mm
  end: string | null
  title: string
  subtitle: string | null
  type: CalItemType
  href: string
  cancelled: boolean
  changed: boolean
}

export type CalFilter = 'all' | 'pair' | 'event' | 'assignment'

function dowOf(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

// Разворачивает недельные пары на конкретные даты диапазона, накладывая изменения.
export function expandPairs(pairs: Pair[], changes: ScheduleChange[], dates: Date[]): CalItem[] {
  const changeByKey = new Map<string, ScheduleChange>()
  for (const c of changes) changeByKey.set(`${c.pairId}|${c.date.slice(0, 10)}`, c)

  const items: CalItem[] = []
  for (const d of dates) {
    const ds = formatYmd(d)
    const dow = dowOf(d)
    const parity = isoWeekParity(d)
    for (const p of pairs) {
      if (p.dayOfWeek !== dow) continue
      if (p.weekType !== 'BOTH' && p.weekType !== parity) continue
      const change = changeByKey.get(`${p.id}|${ds}`) ?? null
      const cancelled = change?.type === 'CANCELLED'
      const start = change?.newStartTime ?? p.startTime
      const end = change?.newEndTime ?? p.endTime
      const room = change?.newRoom ?? p.room
      const teacher = change?.newTeacher ?? p.teacher
      const subtitle = [room?.name, teacher ? `${teacher.firstName} ${teacher.lastName}` : null]
        .filter(Boolean)
        .join(' · ')
      items.push({
        id: `pair-${p.id}-${ds}`,
        date: ds,
        start,
        end,
        title: p.subject,
        subtitle: subtitle || null,
        type: 'pair',
        href: '/schedule',
        cancelled,
        changed: !!change && !cancelled,
      })
    }
  }
  return items
}

// События в конкретные даты (по локальному дню начала).
export function mapEvents(events: EventItem[]): CalItem[] {
  return events.map((ev) => {
    const d = new Date(ev.startsAt)
    return {
      id: `event-${ev.id}`,
      date: formatYmd(d),
      start: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      end: null,
      title: ev.title,
      subtitle: ev.location ?? (ev.isOnline ? 'online' : null),
      type: 'event' as const,
      href: '/events',
      cancelled: false,
      changed: false,
    }
  })
}

// Дедлайны заданий (по dueAt) как события календаря.
export function mapAssignments(assignments: AssignmentItem[]): CalItem[] {
  return assignments
    .filter((a) => a.dueAt != null)
    .map((a) => {
      const d = new Date(a.dueAt as string)
      return {
        id: `assignment-${a.id}`,
        date: formatYmd(d),
        start: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        end: null,
        title: a.title,
        subtitle: a.course.subject.name,
        type: 'assignment' as const,
        href: '/assignments',
        cancelled: false,
        changed: false,
      }
    })
}

export function buildCalendar(
  pairs: Pair[],
  changes: ScheduleChange[],
  events: EventItem[],
  assignments: AssignmentItem[],
  dates: Date[],
  filter: CalFilter,
): CalItem[] {
  const items: CalItem[] = []
  if (filter === 'all' || filter === 'pair') items.push(...expandPairs(pairs, changes, dates))
  if (filter === 'all' || filter === 'event') items.push(...mapEvents(events))
  if (filter === 'all' || filter === 'assignment') items.push(...mapAssignments(assignments))
  return items
}

// Группировка по дате + сортировка внутри дня по времени.
export function groupByDate(items: CalItem[]): Map<string, CalItem[]> {
  const map = new Map<string, CalItem[]>()
  for (const it of items) {
    const list = map.get(it.date) ?? []
    list.push(it)
    map.set(it.date, list)
  }
  for (const [, list] of map) {
    list.sort((a, b) => (a.start ?? '99').localeCompare(b.start ?? '99'))
  }
  return map
}
