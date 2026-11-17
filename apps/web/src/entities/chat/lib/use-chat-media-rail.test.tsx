import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchChatMedia, fetchChatMediaPosition, type ChatMediaPage } from '../api/chat-api'
import type { ChatMediaItem } from '../model/types'
import { useChatMediaRail } from './use-chat-media-rail'

vi.mock('../api/chat-api', async (orig) => {
  const actual = await orig<typeof import('../api/chat-api')>()
  return { ...actual, fetchChatMedia: vi.fn(), fetchChatMediaPosition: vi.fn() }
})

const mediaMock = vi.mocked(fetchChatMedia)
const positionMock = vi.mocked(fetchChatMediaPosition)

const item = (id: string): ChatMediaItem => ({
  id,
  messageId: `m-${id}`,
  name: null,
  mime: 'image/jpeg',
  size: 1,
  hasPoster: false,
  createdAt: '2026-11-17T10:00:00.000Z',
  sender: null,
})

// Медиа чата f1…f7 (f1 — самое старое), открыли f5.
const PAGES: Record<string, ChatMediaPage> = {
  'older:f5': { items: [item('f4'), item('f3')], cursor: 'f3', hasNext: true },
  'older:f3': { items: [item('f2'), item('f1')], hasNext: false },
  'newer:f5': { items: [item('f7'), item('f6')], hasNext: false, prevCursor: 'f7', hasPrev: false },
}

function setup(anchor: ChatMediaItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useChatMediaRail('c1', anchor), { wrapper }).result
}

describe('useChatMediaRail — лента всех медиа чата для просмотрщика', () => {
  beforeEach(() => {
    mediaMock.mockReset()
    positionMock.mockReset()
    mediaMock.mockImplementation(async (_chat, _type, cursor, dir = 'older') => {
      const page = PAGES[`${dir}:${cursor}`]
      if (!page) throw new Error(`нет страницы ${dir}:${cursor}`)
      return page
    })
    positionMock.mockResolvedValue({ index: 5, total: 7 })
  })

  it('кадр открытия посередине: старые слева, номер — по всему чату', async () => {
    const anchor = item('f5')
    const result = setup(anchor)
    await waitFor(() => expect(result.current.items).not.toBeNull())

    expect(result.current.items?.map((i) => i.id)).toEqual(['f3', 'f4', 'f5'])
    // f3 — третье по счёту медиа чата.
    expect(result.current.first).toBe(3)
    expect(result.current.total).toBe(7)
    expect(positionMock).toHaveBeenCalledWith('c1', 'f5', 'media')
  })

  it('у правого края подгружает новее, у левого — старше, номер не съезжает', async () => {
    const result = setup(item('f5'))
    await waitFor(() => expect(result.current.items).not.toBeNull())

    act(() => result.current.reach(2))
    await waitFor(() => expect(result.current.items).toHaveLength(5))
    expect(result.current.items?.map((i) => i.id)).toEqual(['f3', 'f4', 'f5', 'f6', 'f7'])
    expect(mediaMock).toHaveBeenCalledWith('c1', 'media', 'f5', 'newer')

    act(() => result.current.reach(0))
    await waitFor(() => expect(result.current.items).toHaveLength(7))
    expect(result.current.items?.map((i) => i.id)).toEqual([
      'f1',
      'f2',
      'f3',
      'f4',
      'f5',
      'f6',
      'f7',
    ])
    expect(result.current.first).toBe(1)
  })

  it('кадр не из медиа чата (404 номера) — ленты нет, листаются кадры открытия', async () => {
    positionMock.mockRejectedValue(new Error('404'))
    const result = setup(item('f5'))
    await waitFor(() => expect(positionMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.items).toBeNull()
  })
})
