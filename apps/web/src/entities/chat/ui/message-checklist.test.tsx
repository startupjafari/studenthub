import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть; тосты глушим (Toaster в тесте не смонтирован).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }))

vi.mock('../api/chat-api', async (orig) => {
  const actual = await orig<typeof import('../api/chat-api')>()
  return {
    ...actual,
    addChecklistItemRequest: vi.fn(),
    removeChecklistItemRequest: vi.fn(),
    toggleChecklistItemRequest: vi.fn(),
  }
})

import { addChecklistItemRequest, chatKeys, removeChecklistItemRequest } from '../api/chat-api'
import type { ChatMessage, MessageChecklist, MessageChecklistItem } from '../model/types'
import { MessageChecklistView } from './message-checklist'

function item(id: string, text: string): MessageChecklistItem {
  return { id, text, order: 0, done: false, doneAt: null, doneBy: null }
}

function checklist(patch: Partial<MessageChecklist> = {}): MessageChecklist {
  return {
    id: 'cl1',
    title: 'Покупки',
    othersCanAdd: true,
    othersCanMark: true,
    items: [item('i1', 'Хлеб'), item('i2', 'Молоко')],
    ...patch,
  }
}

function setup(props: { checklist: MessageChecklist; mine: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData<ChatMessage[]>(chatKeys.messages('c1'), [
    { id: 'm1', chatId: 'c1', checklist: props.checklist } as unknown as ChatMessage,
  ])
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  render(<MessageChecklistView {...props} chatId="c1" />, { wrapper })
  return qc
}

beforeEach(() => vi.clearAllMocks())

describe('MessageChecklistView — права', () => {
  it('автор видит «Добавить пункт» и крестики у пунктов', () => {
    setup({ checklist: checklist({ othersCanAdd: false }), mine: true })
    expect(screen.getByRole('button', { name: 'checklistAddItem' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'checklistRemoveItem' })).toHaveLength(2)
  })

  it('участник при othersCanAdd добавляет, но чужие пункты не убирает', () => {
    setup({ checklist: checklist(), mine: false })
    expect(screen.getByRole('button', { name: 'checklistAddItem' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'checklistRemoveItem' })).toBeNull()
  })

  it('участник без othersCanAdd не добавляет', () => {
    setup({ checklist: checklist({ othersCanAdd: false }), mine: false })
    expect(screen.queryByRole('button', { name: 'checklistAddItem' })).toBeNull()
  })

  it('на 50 пунктах добавить нельзя даже автору', () => {
    const items = Array.from({ length: 50 }, (_, i) => item(`i${i}`, `п${i}`))
    setup({ checklist: checklist({ items }), mine: true })
    expect(screen.queryByRole('button', { name: 'checklistAddItem' })).toBeNull()
  })
})

describe('MessageChecklistView — действия', () => {
  it('добавленный пункт попадает в сообщение ленты', async () => {
    const next = checklist({ items: [item('i1', 'Хлеб'), item('i2', 'Молоко'), item('i3', 'Сыр')] })
    vi.mocked(addChecklistItemRequest).mockResolvedValue(next)
    const qc = setup({ checklist: checklist(), mine: true })

    await userEvent.click(screen.getByRole('button', { name: 'checklistAddItem' }))
    await userEvent.type(screen.getByLabelText('checklistNewItem'), '  Сыр {Enter}')

    await waitFor(() => expect(addChecklistItemRequest).toHaveBeenCalledWith('cl1', 'Сыр'))
    await waitFor(() =>
      expect(qc.getQueryData<ChatMessage[]>(chatKeys.messages('c1'))?.[0]?.checklist).toEqual(next),
    )
    expect(screen.getByText('Сыр')).toBeInTheDocument()
  })

  it('пустой пункт не отправляется', async () => {
    setup({ checklist: checklist(), mine: true })
    await userEvent.click(screen.getByRole('button', { name: 'checklistAddItem' }))
    await userEvent.type(screen.getByLabelText('checklistNewItem'), '   {Enter}')
    expect(await screen.findByText('checklistItemEmpty')).toBeInTheDocument()
    expect(addChecklistItemRequest).not.toHaveBeenCalled()
  })

  it('крестик убирает пункт', async () => {
    vi.mocked(removeChecklistItemRequest).mockResolvedValue(
      checklist({ items: [item('i2', 'Молоко')] }),
    )
    setup({ checklist: checklist(), mine: true })
    await userEvent.click(screen.getAllByRole('button', { name: 'checklistRemoveItem' })[0]!)
    await waitFor(() => expect(removeChecklistItemRequest).toHaveBeenCalledWith('cl1', 'i1'))
    await waitFor(() => expect(screen.queryByText('Хлеб')).toBeNull())
  })
})
