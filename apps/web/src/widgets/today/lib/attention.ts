import type { ApplicationListItem } from '../../../entities/application-service'
import type { EventItem } from '../../../entities/event'
import { pickLocale } from '../../../entities/application-service'
import { studentAssignmentStatus, type AssignmentItem } from '../../../entities/assignment'

// «Требует внимания»: система собирает задачи из других модулей (заявки, события).
// Приоритеты — urgent (срочно) / today (сегодня) / soon (скоро). Заголовок пункта —
// это контент (имя услуги/события), а вид пункта (kindKey) — ключ i18n.

export type AttentionPriority = 'urgent' | 'today' | 'soon'

export type AttentionKind =
  | 'correctApplication'
  | 'draftApplication'
  | 'eventToday'
  | 'eventSoon'
  | 'assignmentDue'
  | 'assignmentFix'
  | 'assignmentOverdue'

export interface AttentionItem {
  id: string
  priority: AttentionPriority
  kind: AttentionKind
  title: string
  href: string
  // Доп. подпись (срок/время), уже отформатированная контентом.
  meta?: string
}

const PRIORITY_RANK: Record<AttentionPriority, number> = { urgent: 0, today: 1, soon: 2 }

function daysUntil(iso: string, todayDate: string): number {
  const a = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${todayDate}T00:00:00Z`).getTime()
  return Math.round((a - b) / 86400000)
}

interface BuildInput {
  applications: ApplicationListItem[]
  events: EventItem[]
  assignments: AssignmentItem[]
  todayDate: string
  locale: string
}

export function buildAttention({
  applications,
  events,
  assignments,
  todayDate,
  locale,
}: BuildInput): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const a of assignments) {
    const st = studentAssignmentStatus(a)
    if (st === 'SUBMITTED' || st === 'GRADED') continue
    if (st === 'RETURNED') {
      items.push({
        id: `asg-${a.id}`,
        priority: 'urgent',
        kind: 'assignmentFix',
        title: a.title,
        href: '/assignments',
      })
      continue
    }
    if (st === 'OVERDUE') {
      items.push({
        id: `asg-${a.id}`,
        priority: 'urgent',
        kind: 'assignmentOverdue',
        title: a.title,
        href: '/assignments',
      })
      continue
    }
    // NOT_STARTED / DRAFT — по сроку.
    if (!a.dueAt) continue
    const d = daysUntil(a.dueAt, todayDate)
    if (d < 0 || d > 7) continue
    items.push({
      id: `asg-${a.id}`,
      priority: d === 0 ? 'today' : 'soon',
      kind: 'assignmentDue',
      title: a.title,
      href: '/assignments',
    })
  }

  for (const app of applications) {
    const title = pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
    if (app.status === 'NEEDS_CORRECTION') {
      items.push({
        id: `app-${app.id}`,
        priority: 'urgent',
        kind: 'correctApplication',
        title,
        href: '/applications',
        meta: app.number ?? undefined,
      })
    } else if (app.status === 'DRAFT') {
      items.push({
        id: `app-${app.id}`,
        priority: 'soon',
        kind: 'draftApplication',
        title,
        href: '/applications',
      })
    }
  }

  for (const ev of events) {
    if (!ev.isRegistered) continue
    const d = daysUntil(ev.startsAt, todayDate)
    if (d < 0 || d > 7) continue
    items.push({
      id: `event-${ev.id}`,
      priority: d === 0 ? 'today' : 'soon',
      kind: d === 0 ? 'eventToday' : 'eventSoon',
      title: ev.title,
      href: '/events',
    })
  }

  return items.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
}

export function groupByPriority(
  items: AttentionItem[],
): Record<AttentionPriority, AttentionItem[]> {
  return {
    urgent: items.filter((i) => i.priority === 'urgent'),
    today: items.filter((i) => i.priority === 'today'),
    soon: items.filter((i) => i.priority === 'soon'),
  }
}
