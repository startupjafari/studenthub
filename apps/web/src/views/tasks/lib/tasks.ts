import type { ApplicationServiceStatus } from '@studenthub/shared-schemas'
import type { ApplicationListItem } from '../../../entities/application-service'
import { pickLocale } from '../../../entities/application-service'
import type { EventItem } from '../../../entities/event'
import { studentAssignmentStatus, type AssignmentItem } from '../../../entities/assignment'

// «Мои задачи» — автоматический todo-центр. Система формирует задачи из других
// модулей; пользователь не создаёт их вручную. Сейчас источники — заявки и события
// (задания/документы/консультации подключатся со своими доменами, задача 10 + 24).

export type TaskBucket = 'urgent' | 'today' | 'week' | 'later' | 'done'

export type TaskKind =
  | 'submitApplication'
  | 'correctApplication'
  | 'pickupDocument'
  | 'applicationDone'
  | 'attendEvent'
  | 'assignmentDue'
  | 'assignmentFix'
  | 'assignmentDone'

export interface TaskItem {
  id: string
  bucket: TaskBucket
  kind: TaskKind
  title: string
  href: string
  // ISO-дата дедлайна/времени, если есть (для подписи).
  dueAt: string | null
  done: boolean
}

// Активные (требуют действия студента) и завершённые статусы заявки.
const APP_ACTION: Partial<Record<ApplicationServiceStatus, TaskKind>> = {
  DRAFT: 'submitApplication',
  NEEDS_CORRECTION: 'correctApplication',
  READY_FOR_PICKUP: 'pickupDocument',
}
const APP_DONE: ApplicationServiceStatus[] = ['ISSUED', 'DELIVERED']

function dayDiff(iso: string, todayDate: string): number {
  const a = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()
  const b = new Date(`${todayDate}T00:00:00Z`).getTime()
  return Math.round((a - b) / 86400000)
}

// Бакет по дедлайну: просрочено/без срока-но-срочно → urgent; сегодня; в течение недели; позже.
function bucketByDue(dueAt: string | null, todayDate: string, urgentIfNoDue = false): TaskBucket {
  if (!dueAt) return urgentIfNoDue ? 'urgent' : 'later'
  const d = dayDiff(dueAt, todayDate)
  if (d < 0) return 'urgent'
  if (d === 0) return 'today'
  if (d <= 7) return 'week'
  return 'later'
}

interface BuildInput {
  applications: ApplicationListItem[]
  events: EventItem[]
  assignments: AssignmentItem[]
  todayDate: string
  locale: string
}

export function buildTasks({
  applications,
  events,
  assignments,
  todayDate,
  locale,
}: BuildInput): TaskItem[] {
  const items: TaskItem[] = []

  for (const a of assignments) {
    const st = studentAssignmentStatus(a)
    if (st === 'SUBMITTED') continue // ждём проверку — не задача пользователя
    if (st === 'GRADED') {
      items.push({
        id: `assignment-${a.id}`,
        bucket: 'done',
        kind: 'assignmentDone',
        title: a.title,
        href: '/assignments',
        dueAt: a.mySubmission?.gradedAt ?? null,
        done: true,
      })
      continue
    }
    const fix = st === 'RETURNED'
    items.push({
      id: `assignment-${a.id}`,
      bucket: bucketByDue(a.dueAt, todayDate, fix),
      kind: fix ? 'assignmentFix' : 'assignmentDue',
      title: a.title,
      href: '/assignments',
      dueAt: a.dueAt,
      done: false,
    })
  }

  for (const app of applications) {
    const title = pickLocale(app.service as unknown as Record<string, unknown>, 'name', locale)
    if (APP_DONE.includes(app.status)) {
      items.push({
        id: `app-${app.id}`,
        bucket: 'done',
        kind: 'applicationDone',
        title,
        href: '/applications',
        dueAt: app.issuedAt,
        done: true,
      })
      continue
    }
    const kind = APP_ACTION[app.status]
    if (!kind) continue // in-progress (ждём деканат) — не задача пользователя
    // NEEDS_CORRECTION / READY_FOR_PICKUP без срока считаем срочными.
    const urgentNoDue = kind !== 'submitApplication'
    items.push({
      id: `app-${app.id}`,
      bucket: bucketByDue(app.dueAt, todayDate, urgentNoDue),
      kind,
      title,
      href: '/applications',
      dueAt: app.dueAt,
      done: false,
    })
  }

  for (const ev of events) {
    if (!ev.isRegistered) continue
    const d = dayDiff(ev.startsAt, todayDate)
    if (d < 0 || d > 30) continue
    items.push({
      id: `event-${ev.id}`,
      bucket: bucketByDue(ev.startsAt, todayDate),
      kind: 'attendEvent',
      title: ev.title,
      href: '/events',
      dueAt: ev.startsAt,
      done: false,
    })
  }

  return items
}

export const TASK_BUCKET_ORDER: TaskBucket[] = ['urgent', 'today', 'week', 'later', 'done']

export function groupTasks(items: TaskItem[]): Record<TaskBucket, TaskItem[]> {
  const empty: Record<TaskBucket, TaskItem[]> = {
    urgent: [],
    today: [],
    week: [],
    later: [],
    done: [],
  }
  for (const it of items) empty[it.bucket].push(it)
  // Внутри бакета — по дедлайну (без срока в конец).
  for (const b of TASK_BUCKET_ORDER) {
    empty[b].sort((a, c) => (a.dueAt ?? '9999').localeCompare(c.dueAt ?? '9999'))
  }
  return empty
}
