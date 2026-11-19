'use client'

import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { libraryKeys } from '../api/library-api'

/**
 * Живые «Мои книги» читателя (docs/PROJECT.md §9.2d, `library.loan.changed`).
 *
 * Библиотекарь выдал, продлил, принял книгу или отметил утерю — сигнал приходит только
 * читателю. Перечитываются его выдачи, брони (выдача по брони закрывает её) и справка
 * «задолженностей нет» вместе с выданными справками (`clearance` — префикс обоих ключей):
 * долг появился или погашен, отменённый возврат отзывает справку.
 */
export function useMyLoansLive(enabled = true): void {
  useLiveRefresh(
    REALTIME_EVENTS.libraryLoanChanged,
    [libraryKeys.myLoans(), libraryKeys.myReservations(), libraryKeys.clearance()],
    { enabled },
  )
}
