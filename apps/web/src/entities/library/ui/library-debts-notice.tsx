'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { TriangleAlert } from 'lucide-react'
import { Card } from '../../../shared/ui'
import { fetchReaderDebts, libraryKeys } from '../api/library-api'
import { isLostDebt } from '../lib/loan-debt'

/**
 * Предупреждение о книгах за студентом (Фаза 20.11): показывается, когда декан или админ
 * вуза переводит студента в «выпускник», «отчислен» или «переведён». В списке — книги на
 * руках и утерянные, за которые ещё не рассчитались. Это не запрет —
 * статус сохранится, — а напоминание, что книги нужно вернуть до выхода из вуза.
 */
export function LibraryDebtsNotice({ userId }: { userId: string }) {
  const t = useTranslations('LibraryDebts')
  const format = useFormatter()
  const debts = useQuery({
    queryKey: libraryKeys.debts(userId),
    queryFn: () => fetchReaderDebts(userId),
    retry: false,
  })
  if (!debts.data || debts.data.clear) return null
  const { loans, activeReservations } = debts.data
  return (
    <Card className="flex-row items-start gap-3 border-warning/40 bg-warning/10 p-4">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">
        <p className="font-semibold">{t('title', { count: loans.length })}</p>
        <ul className="flex flex-col gap-0.5">
          {loans.map((loan) => (
            <li key={loan.id} className="truncate">
              {isLostDebt(loan) ? (
                t('lostLine', { title: loan.book.title, number: loan.copy.inventoryNumber })
              ) : (
                <>
                  {t('loanLine', {
                    title: loan.book.title,
                    number: loan.copy.inventoryNumber,
                    date: dayOf(loan.dueDate, format),
                  })}
                  {loan.overdue ? ` · ${t('overdue')}` : ''}
                </>
              )}
            </li>
          ))}
        </ul>
        {activeReservations > 0 && (
          <p className="text-muted-foreground">
            {t('reservations', { count: activeReservations })}
          </p>
        )}
        <p className="text-muted-foreground">{t('hint')}</p>
      </div>
    </Card>
  )
}

/** «ГГГГ-ММ-ДД» по часам вуза → день в локали интерфейса, без сдвига поясом браузера. */
function dayOf(date: string, format: ReturnType<typeof useFormatter>): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return format.dateTime(new Date(y, m - 1, d), { day: 'numeric', month: 'short' })
}
