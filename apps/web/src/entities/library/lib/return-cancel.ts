import { LIBRARY_RETURN_CANCEL_HOURS, type LoanItem } from '@studenthub/shared-schemas'

/**
 * Можно ли предложить «Отменить возврат»: выдача закрыта возвратом не больше
 * `LIBRARY_RETURN_CANCEL_HOURS` назад. Остальное (экземпляр на полке, никому не выдан)
 * проверяет сервер — клиент этого не знает и кнопку по нему не прячет.
 */
export function canCancelReturn(
  loan: Pick<LoanItem, 'status' | 'returnedAt'>,
  now: Date = new Date(),
): boolean {
  if (loan.status !== 'RETURNED' || !loan.returnedAt) return false
  return (
    now.getTime() - new Date(loan.returnedAt).getTime() <= LIBRARY_RETURN_CANCEL_HOURS * 3_600_000
  )
}
