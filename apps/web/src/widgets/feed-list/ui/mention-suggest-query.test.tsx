import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

// Сеть глушим, проверяем, КАКИЕ запросы уходят и с какими параметрами.
vi.mock('../../../entities/search/api/search-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/search/api/search-api')>()
  return {
    ...actual,
    fetchSearch: vi.fn().mockResolvedValue({
      people: [
        {
          id: 'u1',
          firstName: 'Иван',
          lastName: 'Иванов',
          username: 'ivanov',
          avatarUrl: null,
          role: 'STUDENT',
        },
      ],
      courses: [],
      assignments: [],
      materials: [],
      events: [],
      chats: [],
    }),
  }
})

import { fetchSearch } from '../../../entities/search'
import { MentionSuggest } from './mention-suggest'

function setup(query: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const onPick = vi.fn()
  const view = render(<MentionSuggest query={query} onPick={onPick} />, { wrapper })
  return {
    rerender: (q: string | null) => view.rerender(<MentionSuggest query={q} onPick={onPick} />),
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => vi.mocked(fetchSearch).mockClear())

// E-F23: подсказка не шлёт невалидных запросов и не гоняет все шесть источников поиска.
describe('MentionSuggest — запросы', () => {
  it('один символ после @ — запроса нет (сервер ответил бы 422)', async () => {
    setup('i')
    await pause(400)
    expect(fetchSearch).not.toHaveBeenCalled()
  })

  it('от двух символов — после паузы, только за людьми', async () => {
    setup('iva')
    expect(fetchSearch).not.toHaveBeenCalled()
    expect(await screen.findByText('@ivanov')).toBeInTheDocument()
    expect(fetchSearch).toHaveBeenCalledTimes(1)
    expect(fetchSearch).toHaveBeenCalledWith('iva', ['people'])
  })

  it('быстрый набор — один запрос по последнему вводу, а не на каждую букву', async () => {
    const { rerender } = setup('iv')
    rerender('iva')
    rerender('ivan')
    await waitFor(() => expect(fetchSearch).toHaveBeenCalled())
    await pause(300)
    expect(fetchSearch).toHaveBeenCalledTimes(1)
    expect(fetchSearch).toHaveBeenCalledWith('ivan', ['people'])
  })

  it('закрытое упоминание прячет подсказку сразу', async () => {
    const { rerender } = setup('iva')
    expect(await screen.findByText('@ivanov')).toBeInTheDocument()
    rerender(null)
    expect(screen.queryByText('@ivanov')).not.toBeInTheDocument()
  })
})
