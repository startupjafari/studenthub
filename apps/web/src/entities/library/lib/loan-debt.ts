import type { LoanItem } from '@studenthub/shared-schemas'

/**
 * Утерянная книга без отметки «долг погашен» — долг читателя (docs/PROJECT.md §3.11): как
 * просрочка, закрывает справку, выдачу и брони, пока библиотекарь не отметит погашение.
 */
export function isLostDebt(loan: Pick<LoanItem, 'status' | 'lostSettledAt'>): boolean {
  return loan.status === 'LOST' && loan.lostSettledAt === null
}
