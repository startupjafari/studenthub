import type { PrismaService } from '../../common/prisma/prisma.service'
import { endOfDay, startOfDay, todayIn } from '../library/library-dates'

// День журнала — по часам вуза, как сроки библиотеки: «сегодня» на посту в Алматы не должно
// начинаться в пять утра.

export async function universityTimezone(prisma: PrismaService, universityId: string) {
  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { timezone: true },
  })
  return university?.timezone || 'Asia/Almaty'
}

/** Сутки `date` («ГГГГ-ММ-ДД») по часам вуза: [начало, начало следующих). */
export function dayRange(date: string, timezone: string): { gte: Date; lt: Date } {
  return {
    gte: startOfDay(date, timezone),
    lt: new Date(endOfDay(date, timezone).getTime() + 1),
  }
}

export { todayIn }
