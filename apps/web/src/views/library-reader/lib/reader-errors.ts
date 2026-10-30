import { useTranslations } from 'next-intl'
import { toApiError } from '../../../shared/lib'

// Отказы брони и «это не я» глазами читателя: тот же `details.field`, что у стойки выдачи,
// но текст обращён к самому студенту («у вас просрочена книга»), а не к библиотекарю.
type ReaderField =
  | 'status'
  | 'overdue'
  | 'lost'
  | 'reservationLimit'
  | 'alreadyReserved'
  | 'alreadyBorrowed'
  | 'noCopies'
  | 'closed'
  | 'notOnLoan'
  | 'module'

export function useReaderErrors(): (error: unknown) => string {
  const t = useTranslations('LibraryReader')
  const tErr = useTranslations('Errors')
  const byField: Record<ReaderField, string> = {
    status: t('error.status'),
    overdue: t('error.overdue'),
    lost: t('error.lost'),
    reservationLimit: t('error.reservationLimit'),
    alreadyReserved: t('error.alreadyReserved'),
    alreadyBorrowed: t('error.alreadyBorrowed'),
    noCopies: t('error.noCopies'),
    closed: t('error.closed'),
    notOnLoan: t('error.notOnLoan'),
    module: t('error.module'),
  }
  return (error) => {
    const err = toApiError(error)
    const field = err.details?.[0]?.field
    if (err.code === 'CONFLICT' && field && field in byField) return byField[field as ReaderField]
    if (err.code === 'NOT_FOUND') return t('error.notFound')
    return tErr(err.code)
  }
}
