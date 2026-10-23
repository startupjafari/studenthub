import { useTranslations } from 'next-intl'
import { toApiError } from '../../../shared/lib'

// Отказы выдачи, возврата и брони: сервер отвечает 409 с `details.field` — по нему и выбираем текст
// (FRONTEND_RULES §5.4: клиент реагирует на код, а не на сообщение сервера).
type DeskField =
  | 'status'
  | 'overdue'
  | 'lost'
  | 'limit'
  | 'onLoan'
  | 'reserved'
  | 'withdrawn'
  | 'archived'
  | 'ticket'
  | 'module'
  | 'reader'
  | 'notOnLoan'
  | 'renewals'
  | 'queue'
  | 'reservationLimit'
  | 'alreadyReserved'
  | 'alreadyBorrowed'
  | 'noCopies'
  | 'closed'
  | 'notReturned'
  | 'returnWindow'
  | 'reissued'
  | 'heldForReservation'
  | 'notLost'
  | 'settled'

export function useDeskErrors(): (error: unknown) => string {
  const t = useTranslations('LibraryDesk')
  const tErr = useTranslations('Errors')
  const byField: Record<DeskField, string> = {
    status: t('error.status'),
    overdue: t('error.overdue'),
    lost: t('error.lost'),
    limit: t('error.limit'),
    onLoan: t('error.onLoan'),
    reserved: t('error.reserved'),
    withdrawn: t('error.withdrawn'),
    archived: t('error.archived'),
    ticket: t('error.ticket'),
    module: t('error.module'),
    reader: t('error.reader'),
    notOnLoan: t('error.notOnLoan'),
    renewals: t('error.renewals'),
    queue: t('error.queue'),
    reservationLimit: t('error.reservationLimit'),
    alreadyReserved: t('error.alreadyReserved'),
    alreadyBorrowed: t('error.alreadyBorrowed'),
    noCopies: t('error.noCopies'),
    closed: t('error.closed'),
    notReturned: t('error.notReturned'),
    returnWindow: t('error.returnWindow'),
    reissued: t('error.reissued'),
    heldForReservation: t('error.heldForReservation'),
    notLost: t('error.notLost'),
    settled: t('error.settled'),
  }
  return (error) => {
    const err = toApiError(error)
    const field = err.details?.[0]?.field
    if (err.code === 'CONFLICT' && field && field in byField) return byField[field as DeskField]
    if (err.code === 'CONFLICT') return t('error.qrUsed')
    if (err.code === 'BAD_REQUEST') return t('error.qrExpired')
    if (err.code === 'VALIDATION_ERROR' && field === 'dueDate') return t('error.dueDate')
    if (err.code === 'NOT_FOUND') return t('error.notFound')
    return tErr(err.code)
  }
}

/** Ошибка — «пропуск истёк или не наш»: надо сканировать студенческий заново. */
export function isTicketError(error: unknown): boolean {
  const err = toApiError(error)
  return err.code === 'CONFLICT' && err.details?.[0]?.field === 'ticket'
}

/** Сегодня «ГГГГ-ММ-ДД» по часам браузера — нижняя граница выбора срока (сервер проверит сам). */
export function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
