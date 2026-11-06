import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { NotificationMessageKey } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { localDateTimeLabel } from '../../common/time/local-label'
import { NOTIFICATION_JOBS } from '../../common/queue/queue.constants'
import { LibraryNotifier } from './library-notifier'
import { addDays, endOfDay, formatDay, todayIn } from './library-dates'

// Напоминания о сроке выдачи (Фаза 20.7, docs/PROJECT.md §3.11). Расписание — в
// CleanupService (`remindLibraryLoans`, BACKEND_RULES §9.3), логика — здесь, у владельца
// таблицы. Три напоминания: за два дня, в последний день и о просрочке (повтор раз в неделю,
// пока книга не вернётся). Каждое — по отметке в выдаче, поэтому пропущенный тик догоняет
// следующий, а повторный не шлёт второе. Продление отметки сбрасывает (20.5).
//
// Отметка ставится только тем выдачам, чьё уведомление очередь действительно приняла:
// QueueService ошибку постановки глушит, и отметка «вслепую» при упавшем Redis теряла бы
// напоминание навсегда. Первая же неудача останавливает прогон — Redis, скорее всего, лежит,
// и каждая следующая попытка лишь ждала бы таймаут постановки; недоставленное догонит
// следующий тик.

const BATCH_SIZE = 500
/** Местные часы, в которые шлём: ночью уведомление о книге никому не нужно. */
const REMIND_FROM_HOUR = 9
const REMIND_TO_HOUR = 21
/** Напоминание о просрочке повторяется, пока книга не вернётся. */
const OVERDUE_REPEAT_DAYS = 7

type Kind = 'dueSoon' | 'dueToday' | 'overdue'

const MARK: Record<Kind, 'dueSoonSentAt' | 'dueTodaySentAt' | 'overdueSentAt'> = {
  dueSoon: 'dueSoonSentAt',
  dueToday: 'dueTodaySentAt',
  overdue: 'overdueSentAt',
}

const TEXT: Record<Kind, { title: NotificationMessageKey; body: NotificationMessageKey }> = {
  dueSoon: { title: 'library.dueSoon.title', body: 'library.dueSoon.body' },
  dueToday: { title: 'library.dueToday.title', body: 'library.dueToday.body' },
  overdue: { title: 'library.overdue.title', body: 'library.overdue.body' },
}

export interface ReminderCounts {
  dueSoon: number
  dueToday: number
  overdue: number
}

/** Итог одного вида напоминаний: сколько ушло и сорвалась ли постановка в очередь. */
interface RunResult {
  sent: number
  failed: boolean
}

@Injectable()
export class LibraryRemindersService {
  private readonly logger = new Logger(LibraryRemindersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: LibraryNotifier,
  ) {}

  /** Один прогон по всем вузам с включённой библиотекой. */
  async remindDue(now = new Date()): Promise<ReminderCounts> {
    const counts: ReminderCounts = { dueSoon: 0, dueToday: 0, overdue: 0 }
    let cursor: string | undefined
    let failed = false
    while (!failed) {
      const libraries = await this.prisma.librarySettings.findMany({
        where: { enabled: true },
        orderBy: { universityId: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { universityId: cursor }, skip: 1 } : {}),
        select: { universityId: true, university: { select: { timezone: true } } },
      })
      for (const lib of libraries) {
        const timezone = lib.university.timezone || 'Asia/Almaty'
        if (!isDaytime(now, timezone)) continue
        const sent = await this.remindUniversity(lib.universityId, timezone, now)
        counts.dueSoon += sent.counts.dueSoon
        counts.dueToday += sent.counts.dueToday
        counts.overdue += sent.counts.overdue
        if (sent.failed) {
          failed = true
          break
        }
      }
      if (libraries.length < BATCH_SIZE) break
      cursor = libraries[libraries.length - 1]?.universityId
    }
    const total = counts.dueSoon + counts.dueToday + counts.overdue
    if (total > 0) {
      this.logger.log(
        `remindLibraryLoans: скоро ${counts.dueSoon}, сегодня ${counts.dueToday}, просрочка ${counts.overdue}`,
      )
    }
    if (failed) {
      this.logger.warn(
        'remindLibraryLoans: очередь уведомлений недоступна — остаток на следующий тик',
      )
    }
    return counts
  }

  private async remindUniversity(
    universityId: string,
    timezone: string,
    now: Date,
  ): Promise<{ counts: ReminderCounts; failed: boolean }> {
    const today = todayIn(timezone, now)
    const endOfToday = endOfDay(today, timezone)
    // Начало сегодняшних суток: книгу, взятую сегодня, «скоро сдавать» не напоминаем.
    const startOfToday = new Date(endOfDay(addDays(today, -1), timezone).getTime() + 1)
    const base = { universityId, status: 'OPEN' as const }
    const plan: [Kind, Prisma.LoanWhereInput][] = [
      [
        'dueSoon',
        {
          ...base,
          dueAt: { gt: endOfToday, lte: endOfDay(addDays(today, 2), timezone) },
          issuedAt: { lt: startOfToday },
          dueSoonSentAt: null,
        },
      ],
      [
        'dueToday',
        {
          ...base,
          dueAt: { gte: startOfToday, lte: endOfToday },
          issuedAt: { lt: startOfToday },
          dueTodaySentAt: null,
        },
      ],
      [
        'overdue',
        {
          ...base,
          dueAt: { lt: now },
          OR: [
            { overdueSentAt: null },
            { overdueSentAt: { lt: new Date(now.getTime() - OVERDUE_REPEAT_DAYS * 86_400_000) } },
          ],
        },
      ],
    ]
    const counts: ReminderCounts = { dueSoon: 0, dueToday: 0, overdue: 0 }
    for (const [kind, where] of plan) {
      const result = await this.run(kind, timezone, where)
      counts[kind] = result.sent
      if (result.failed) return { counts, failed: true }
    }
    return { counts, failed: false }
  }

  /**
   * Батчами по курсору: шлём уведомление и отмечаем выдачи, чьё уведомление очередь приняла.
   * На первой неудаче — отмечаем уже поставленные и выходим: неотмеченные остаются в выборке
   * и уйдут на следующем тике.
   */
  private async run(
    kind: Kind,
    timezone: string,
    where: Prisma.LoanWhereInput,
  ): Promise<RunResult> {
    let sent = 0
    let failed = false
    let cursor: string | undefined
    while (!failed) {
      // Курсор — условием, а не `cursor:`: отмеченные строки из выборки уже выпали.
      const loans = await this.prisma.loan.findMany({
        where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, readerId: true, bookTitle: true, dueAt: true },
      })
      const queued: string[] = []
      for (const loan of loans) {
        if (!loan.readerId) continue
        const dueDate = todayIn(timezone, loan.dueAt)
        const ok = await this.notifier.send({
          recipientIds: [loan.readerId],
          job: NOTIFICATION_JOBS.LIBRARY_REMINDER,
          titleKey: TEXT[kind].title,
          bodyKey: TEXT[kind].body,
          params: { title: loan.bookTitle, date: formatDay(dueDate) },
          url: '/my-books',
          // В ключе срок: после продления напоминания о новом сроке — новые уведомления, а не
          // повтор, который отбросит очередь. Просрочка повторяется — ещё и день отправки.
          dedupeKey: `library-${kind}:${loan.id}:${dueDate}${kind === 'overdue' ? `:${todayIn(timezone)}` : ''}`,
        })
        if (!ok) {
          failed = true
          break
        }
        queued.push(loan.id)
        sent += 1
      }
      if (queued.length > 0) {
        await this.prisma.loan.updateMany({
          where: { id: { in: queued } },
          data: { [MARK[kind]]: new Date() },
        })
      }
      if (loans.length < BATCH_SIZE) break
      cursor = loans[loans.length - 1]?.id
    }
    return { sent, failed }
  }
}

function isDaytime(now: Date, timezone: string): boolean {
  const hour = Number(localDateTimeLabel(now, timezone).slice(11, 13))
  return hour >= REMIND_FROM_HOUR && hour < REMIND_TO_HOUR
}
