import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))

vi.mock('../../../entities/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../entities/chat')>()),
  fetchChatMedia: vi.fn(),
  fetchAttachmentLink: vi.fn(),
}))

import { fetchAttachmentLink, fetchChatMedia, type ChatMediaItem } from '../../../entities/chat'
import {
  displayUrl,
  formatDuration,
  isRateLimited,
  linkRetry,
  linkRetryDelay,
  mediaGridItems,
  MediaTab,
  sharedItemDate,
  videoTileMode,
} from './shared-media'

const RATE_LIMIT = { code: 'RATE_LIMIT', message: 'Too many requests' }
const SERVER = { code: 'INTERNAL_ERROR', message: '' }

function item(id: string, patch: Partial<ChatMediaItem> = {}): ChatMediaItem {
  return {
    id,
    messageId: `msg-${id}`,
    name: `${id}.png`,
    mime: 'image/png',
    size: 1000,
    hasPoster: false,
    createdAt: '2026-11-20T10:00:00Z',
    sender: null,
    ...patch,
  }
}

describe('повтор ссылки на вложение', () => {
  it('узнаёт 429 по коду ошибки', () => {
    expect(isRateLimited(RATE_LIMIT)).toBe(true)
    expect(isRateLimited(SERVER)).toBe(false)
    expect(isRateLimited(new Error('network'))).toBe(false)
  })

  it('лимит повторяет до четырёх раз, прочие ошибки — один', () => {
    expect(linkRetry(0, RATE_LIMIT)).toBe(true)
    expect(linkRetry(3, RATE_LIMIT)).toBe(true)
    expect(linkRetry(4, RATE_LIMIT)).toBe(false)
    expect(linkRetry(0, SERVER)).toBe(true)
    expect(linkRetry(1, SERVER)).toBe(false)
  })

  it('при лимите ждёт дольше минутного окна, а не секунду', () => {
    const delays = [0, 1, 2, 3].map((n) => linkRetryDelay(n, RATE_LIMIT))
    expect(delays).toEqual([5000, 10_000, 20_000, 40_000])
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(60_000)
    expect(linkRetryDelay(0, SERVER)).toBe(1000)
  })
})

describe('sharedItemDate', () => {
  const now = new Date(2026, 10, 20, 18, 0) // пт, 20 нояб. 2026
  const at = (day: string, time: string) => `${day} в ${time}`
  const iso = (d: Date) => d.toISOString()

  it('сегодня и вчера — относительным днём со временем', () => {
    expect(sharedItemDate(iso(new Date(2026, 10, 20, 15, 42)), 'ru', at, now)).toBe(
      'сегодня в 15:42',
    )
    expect(sharedItemDate(iso(new Date(2026, 10, 19, 9, 5)), 'ru', at, now)).toBe('вчера в 09:05')
  })

  it('часы устройства отстают — будущее тоже «сегодня»', () => {
    expect(sharedItemDate(iso(new Date(2026, 10, 21, 0, 10)), 'ru', at, now)).toBe(
      'сегодня в 00:10',
    )
  })

  it('на этой неделе — день недели, раньше — число и месяц', () => {
    expect(sharedItemDate(iso(new Date(2026, 10, 18, 15, 42)), 'ru', at, now)).toBe('ср 15:42')
    expect(sharedItemDate(iso(new Date(2026, 10, 12, 8, 0)), 'ru', at, now)).toBe('12 нояб. 08:00')
  })

  it('прошлый год — с годом', () => {
    expect(sharedItemDate(iso(new Date(2025, 0, 3, 8, 0)), 'ru', at, now)).toMatch(/2025/)
  })

  it('битая дата — пустая строка', () => {
    expect(sharedItemDate('not a date', 'ru', at, now)).toBe('')
  })
})

describe('плитка видео', () => {
  it('постер — картинкой, проигрываемый формат — кадром, .mov — заглушкой', () => {
    const can = (mime: string) => mime !== 'video/quicktime'
    expect(videoTileMode({ mime: 'video/mp4', hasPoster: true }, can)).toBe('poster')
    expect(videoTileMode({ mime: 'video/mp4', hasPoster: false }, can)).toBe('frame')
    expect(videoTileMode({ mime: 'video/quicktime', hasPoster: false }, can)).toBe('stub')
  })

  it('длительность — минуты и секунды', () => {
    expect(formatDuration(4000)).toBe('0:04')
    expect(formatDuration(724_400)).toBe('12:04')
    expect(formatDuration(-5)).toBe('0:00')
  })

  it('GIF в сетку «Медиа» не попадают — у них своя вкладка', () => {
    const list = [item('a'), item('g', { mime: 'video/mp4', animation: true }), item('v')]
    expect(mediaGridItems(list).map((it) => it.id)).toEqual(['a', 'v'])
  })
})

describe('displayUrl', () => {
  it('без схемы, www и хвостового слэша', () => {
    expect(displayUrl('https://www.github.com/topics/')).toBe('github.com/topics')
    expect(displayUrl('http://egov.kz')).toBe('egov.kz')
  })
})

describe('MediaTab: ссылки только у видимых плиток', () => {
  let observers: { cb: IntersectionObserverCallback; nodes: Element[] }[] = []

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    observers = []
    globalThis.IntersectionObserver = class {
      private entry: { cb: IntersectionObserverCallback; nodes: Element[] }
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb, nodes: [] }
        observers.push(this.entry)
      }
      observe(node: Element): void {
        this.entry.nodes.push(node)
      }
      disconnect(): void {
        this.entry.nodes = []
      }
      unobserve(): void {}
    } as unknown as typeof IntersectionObserver
    vi.mocked(fetchAttachmentLink).mockImplementation(
      async (id: string) =>
        ({
          url: `https://s3/${id}`,
          status: 'READY',
          placeholder: null,
          width: 100,
          height: 100,
          durationMs: null,
          sources: [],
          poster: [],
          hls: null,
          expiresAt: '2026-11-20T20:00:00Z',
          mime: 'image/png',
          animation: false,
        }) as unknown as Awaited<ReturnType<typeof fetchAttachmentLink>>,
    )
    vi.mocked(fetchChatMedia).mockResolvedValue({
      items: [
        item('photo'),
        item('gif', { mime: 'video/mp4', animation: true, hasPoster: true }),
        item('mov', { mime: 'video/quicktime', name: 'clip.mov', durationMs: 4000 }),
      ],
      hasNext: false,
      cursor: null,
    } as unknown as Awaited<ReturnType<typeof fetchChatMedia>>)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function show(node: Element): void {
    for (const o of observers) {
      if (!o.nodes.includes(node)) continue
      o.cb(
        [{ isIntersecting: true, target: node } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    }
  }

  it('без GIF, ссылку просит только показанный снимок, .mov — заглушка без запроса', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    render(<MediaTab chatId="c1" onJump={() => {}} />, { wrapper })

    const tiles = await screen.findAllByRole('button', { name: 'tgRight.openMedia' })
    expect(tiles).toHaveLength(2)
    // Длительность ролика видна и без кадра.
    expect(screen.getByText('0:04')).toBeTruthy()
    expect(fetchAttachmentLink).not.toHaveBeenCalled()

    const [photo, mov] = tiles as [HTMLElement, HTMLElement]
    act(() => {
      show(photo)
      show(mov)
    })
    // Мимо пролистали — выдержка не прошла, запроса нет.
    expect(fetchAttachmentLink).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    await waitFor(() => expect(fetchAttachmentLink).toHaveBeenCalledTimes(1))
    expect(vi.mocked(fetchAttachmentLink).mock.calls[0]?.[0]).toBe('photo')
  })
})
