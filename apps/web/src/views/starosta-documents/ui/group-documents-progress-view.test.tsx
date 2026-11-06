import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupRequestProgress } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/document-request/api/document-request-api', async (orig) => {
  const actual =
    await orig<typeof import('../../../entities/document-request/api/document-request-api')>()
  return { ...actual, fetchGroupProgress: vi.fn() }
})

import { fetchGroupProgress } from '../../../entities/document-request'
import { GroupDocumentsProgressView } from './group-documents-progress-view'

const ACADEMIC: GroupRequestProgress = {
  id: 'r1',
  title: 'Транскрипты',
  dueAt: null,
  acceptsSubmissions: true,
  kind: 'ACADEMIC',
  counts: { total: 2, notSubmitted: 0, submitted: 1, needsFix: 0, accepted: 1 },
  members: [
    { id: 'a', name: 'Абишева Асем', status: 'ACCEPTED' },
    { id: 'b', name: 'Бекова Дана', status: 'SUBMITTED' },
  ],
}
const PERSONAL: GroupRequestProgress = {
  id: 'r2',
  title: 'Паспорта к общежитию',
  dueAt: null,
  acceptsSubmissions: true,
  kind: 'PERSONAL',
  counts: { total: 2, notSubmitted: 1, submitted: 1, needsFix: null, accepted: 0 },
  members: null,
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<GroupDocumentsProgressView />, { wrapper })
  return userEvent.setup()
}

afterEach(() => vi.clearAllMocks())

describe('GroupDocumentsProgressView', () => {
  it('учебный запрос раскрывается поимённо со статусом комплекта', async () => {
    vi.mocked(fetchGroupProgress).mockResolvedValue([ACADEMIC])
    const user = setup()
    expect(await screen.findByText('Транскрипты')).toBeInTheDocument()
    expect(screen.getByText('Приняты: 1')).toBeInTheDocument()
    expect(screen.queryByText('Абишева Асем')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Показать поимённо' }))
    expect(screen.getByText('Абишева Асем')).toBeInTheDocument()
    expect(screen.getByText('На проверке')).toBeInTheDocument()
  })

  it('запрос с личными документами — только цифры, без имён и без «на исправлении»', async () => {
    vi.mocked(fetchGroupProgress).mockResolvedValue([PERSONAL])
    setup()
    expect(await screen.findByText('Паспорта к общежитию')).toBeInTheDocument()
    expect(screen.getByText('Не отправили: 1')).toBeInTheDocument()
    expect(screen.queryByText(/На исправлении/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показать поимённо' })).not.toBeInTheDocument()
    expect(screen.getByText(/поимённо не показывается/)).toBeInTheDocument()
  })

  it('нет запросов — пояснение', async () => {
    vi.mocked(fetchGroupProgress).mockResolvedValue([])
    setup()
    expect(await screen.findByText('Открытых запросов для группы нет')).toBeInTheDocument()
  })
})
