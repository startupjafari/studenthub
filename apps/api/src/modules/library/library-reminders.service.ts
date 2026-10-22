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
    for (;;) {
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
        counts.dueSoon += sent.dueSoon
        counts.dueToday += sent.dueToday
        counts.overdue += sent.overdue
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
    return counts
  }

  private async remindUniversity(
    universityId: string,
    timezone: string,
    now: Date,
  ): Promise<ReminderCounts> {
    const today = todayIn(timezone, now)
    const endOfToday = endOfDay(today, timezone)
    // Начало сегодняшних суток: книгу, взятую сегодня, «скоро сдавать» не напоминаем.
    const startOfToday = new Date(endOfDay(addDays(today, -1), timezone).getTime() + 1)
    const base = { universityId, status: 'OPEN' as const }
    return {
      dueSoon: await this.run('dueSoon', timezone, {
        ...base,
        dueAt: { gt: endOfToday, lte: endOfDay(addDays(today, 2), timezone) },
        issuedAt: { lt: startOfToday },
        dueSoonSentAt: null,
      }),
      dueToday: await this.run('dueToday', timezone, {
        ...base,
        dueAt: { gte: startOfToday, lte: endOfToday },
        issuedAt: { lt: startOfToday },
        dueTodaySentAt: null,
      }),
      overdue: await this.run('overdue', timezone, {
        ...base,
        dueAt: { lt: now },
        OR: [
          { overdueSentAt: null },
          { overdueSentAt: { lt: new Date(now.getTime() - OVERDUE_REPEAT_DAYS * 86_400_000) } },
        ],
      }),
    }
  }

  /** Батчами по курсору: шлём уведомление и ставим отметку, пока выборка не опустеет. */
  private async run(kind: Kind, timezone: string, where: Prisma.LoanWhereInput): Promise<number> {
    let sent = 0
    let cursor: string | undefined
    for (;;) {
      // Курсор — условием, а не `cursor:`: отмеченные строки из выборки уже выпали.
      const loans = await this.prisma.loan.findMany({
        where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, readerId: true, bookTitle: true, dueAt: true },
      })
      for (const loan of loans) {
        if (!loan.readerId) continue
        const dueDate = todayIn(timezone, loan.dueAt)
        await this.notifier.send({
          recipientIds: [loan.readerId],
          job: NOTIFICATION_JOBS.LIBRARY_REMINDER,
          titleKey: TEXT[kind].title,
          bodyKey: TEXT[kind].body,
          params: { title: loan.bookTitle, date: formatDay(dueDate) },
          url: '/my-books',
          // Просрочка повторяется — в ключе день отправки, иначе повтор отбросит очередь.
          dedupeKey: `library-${kind}:${loan.id}${kind === 'overdue' ? `:${todayIn(timezone)}` : ''}`,
        })
        sent += 1
      }
      if (loans.length > 0) {
        await this.prisma.loan.updateMany({
          where: { id: { in: loans.map((l) => l.id) } },
          data: { [MARK[kind]]: new Date() },
        })
      }
      if (loans.length < BATCH_SIZE) break
      cursor = loans[loans.length - 1]?.id
    }
    return sent
  }
}

function isDaytime(now: Date, timezone: string): boolean {
  const hour = Number(localDateTimeLabel(now, timezone).slice(11, 13))
  return hour >= REMIND_FROM_HOUR && hour < REMIND_TO_HOUR
}
