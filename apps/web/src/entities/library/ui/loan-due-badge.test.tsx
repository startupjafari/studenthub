import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import type { LoanItem } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'
import { isLostDebt } from '../lib/loan-debt'
import { LoanDueBadge } from './loan-due-badge'

// Утерянная книга — долг, пока библиотекарь не отметит погашение (§3.11): бейдж и признак
// долга должны различать «утеряна, не рассчитались» и «утеряна, погашено».

function loan(over: Partial<LoanItem> = {}): LoanItem {
  return {
    id: 'loan-1',
    status: 'OPEN',
    issuedAt: '2026-10-01T05:00:00.000Z',
    dueAt: '2026-10-15T18:59:59.999Z',
    dueDate: '2026-10-15',
    overdue: false,
    renewals: 0,
    returnedAt: null,
    cancelledAt: null,
    cancelReason: null,
    disputedAt: null,
    lostSettledAt: null,
    book: { id: 'book-1', title: 'Абай жолы', authors: '', coverUrl: null },
    copy: { id: 'copy-1', inventoryNumber: '101' },
    reader: { id: 'stu-1', name: 'Оспанов Нурлан', group: null, card: null },
    issuedBy: null,
    ...over,
  }
}

function renderBadge(item: LoanItem) {
  return render(
    <NextIntlClientProvider locale="ru" messages={ru}>
      <LoanDueBadge loan={item} />
    </NextIntlClientProvider>,
  )
}

describe('Утерянная книга', () => {
  it('без погашения — долг', () => {
    expect(isLostDebt(loan({ status: 'LOST' }))).toBe(true)
    renderBadge(loan({ status: 'LOST' }))
    expect(screen.getByText(ru.LibraryDesk.statusLostDebt)).toBeTruthy()
  })

  it('погашенная — уже не долг', () => {
    const settled = loan({ status: 'LOST', lostSettledAt: '2026-10-20T06:00:00.000Z' })
    expect(isLostDebt(settled)).toBe(false)
    renderBadge(settled)
    expect(screen.getByText(ru.LibraryDesk.statusLostSettled)).toBeTruthy()
  })

  it('открытая и возвращённая — не утерянный долг', () => {
    expect(isLostDebt(loan())).toBe(false)
    expect(isLostDebt(loan({ status: 'RETURNED' }))).toBe(false)
  })
})
