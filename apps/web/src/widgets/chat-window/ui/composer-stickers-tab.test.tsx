import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Вкладка стикеров панели символов: полоса наборов — по лёгкой выдаче сразу, стикеры набора
// каталога — только когда он подъехал к окну (как Telegram).

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../shared/realtime', () => ({ useRealtimeEvent: () => {} }))

vi.mock('../../../entities/chat', () => ({
  composerKeys: {
    stickerSets: () => ['sticker-sets'],
    stickerSet: (id: string) => ['sticker-sets', 'set', id],
    stickerFavorites: () => ['sticker-favorites'],
  },
  fetchStickerSetsSummary: vi.fn(),
  fetchCatalogStickerSet: vi.fn(),
  fetchFavoriteStickers: vi.fn(),
  addFavoriteStickerRequest: vi.fn(),
  removeFavoriteStickerRequest: vi.fn(),
}))

vi.mock('../../../entities/sticker-set', () => ({
  userStickerKeys: { all: ['user-stickers'], added: () => ['user-stickers', 'added'] },
  fetchAddedStickerSets: vi.fn(),
  openMyStickerSets: vi.fn(),
  pickStickerSource: vi.fn(),
}))

// Соседние вкладки здесь не нужны: у них свои тесты и свои запросы.
vi.mock('./composer-emoji-tab', () => ({ ComposerEmojiTab: () => null }))
vi.mock('./composer-gifs-tab', () => ({ GifsTab: () => null }))

import {
  fetchCatalogStickerSet,
  fetchFavoriteStickers,
  fetchStickerSetsSummary,
} from '../../../entities/chat'
import { fetchAddedStickerSets } from '../../../entities/sticker-set'
import { ComposerSymbolMenu } from './composer-symbol-menu'

const sticker = (id: string) => ({
  id,
  emoji: '🙂',
  width: 512,
  height: 512,
  animated: false,
  url: `https://s3/${id}.webp`,
  expiresAt: '2026-11-21T10:15:00Z',
})

const summary = (id: string, count: number) => ({
  id,
  title: `Набор ${id}`,
  slug: id,
  count,
  cover: count > 0 ? sticker(`${id}-0`) : null,
})

/** Наблюдатели по элементу: тест сам решает, какой набор «подъехал» к окну. */
const observers: { target: Element; fire: (visible: boolean) => void }[] = []

function nearSet(title: string, visible = true): void {
  const section = screen.getByRole('region', { name: title })
  for (const o of observers) if (section.contains(o.target)) o.fire(visible)
}

beforeAll(() => {
  Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo
  globalThis.IntersectionObserver = class {
    constructor(private readonly cb: IntersectionObserverCallback) {}
    observe(target: Element): void {
      observers.push({
        target,
        fire: (visible) =>
          this.cb(
            [{ isIntersecting: visible, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
      })
    }
    disconnect(): void {}
    unobserve(): void {}
  } as unknown as typeof IntersectionObserver
})

beforeEach(() => {
  observers.length = 0
  vi.clearAllMocks()
  vi.mocked(fetchFavoriteStickers).mockResolvedValue([])
  vi.mocked(fetchAddedStickerSets).mockResolvedValue([])
  vi.mocked(fetchStickerSetsSummary).mockResolvedValue([
    summary('a', 2),
    summary('b', 3),
    summary('empty', 0),
  ])
  vi.mocked(fetchCatalogStickerSet).mockImplementation((id: string) =>
    Promise.resolve({
      id,
      title: `Набор ${id}`,
      slug: id,
      stickers: Array.from({ length: id === 'a' ? 2 : 3 }, (_, i) => sticker(`${id}-${i}`)),
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

function renderTab(onSticker = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(
    <ComposerSymbolMenu
      variant="popover"
      tab="stickers"
      onTabChange={() => {}}
      allowMedia
      onEmoji={() => {}}
      onSticker={onSticker}
      onGif={() => {}}
    />,
    { wrapper },
  )
  return { onSticker }
}

describe('Вкладка стикеров: наборы по требованию', () => {
  it('полоса наборов и заглушки — сразу, без запроса стикеров', async () => {
    renderTab()
    expect(await screen.findByRole('button', { name: 'Набор a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Набор b' })).toBeInTheDocument()
    // Пустой набор в панель не попадает.
    expect(screen.queryByRole('button', { name: 'Набор empty' })).not.toBeInTheDocument()
    // Заглушки по числу стикеров: высота раздела готова до загрузки.
    const b = screen.getByRole('region', { name: 'Набор b' })
    expect(b.querySelectorAll('[aria-busy] > div')).toHaveLength(3)
    expect(fetchCatalogStickerSet).not.toHaveBeenCalled()
  })

  it('набор, задержавшийся у окна, догружается и отправляет стикер', async () => {
    const { onSticker } = renderTab()
    await screen.findByRole('region', { name: 'Набор b' })
    vi.useFakeTimers()
    act(() => nearSet('Набор b'))
    act(() => vi.advanceTimersByTime(200))
    vi.useRealTimers()

    await waitFor(() => expect(fetchCatalogStickerSet).toHaveBeenCalledWith('b'))
    expect(fetchCatalogStickerSet).toHaveBeenCalledTimes(1)
    const b = screen.getByRole('region', { name: 'Набор b' })
    const cells = await within(b).findAllByRole('button', { name: 'tgComposer.stickerAlt' })
    expect(cells).toHaveLength(3)
    await userEvent.click(cells[1]!)
    expect(onSticker).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-1' }))
  })

  it('набор, мимо которого пролетели, в сеть не уходит', async () => {
    renderTab()
    await screen.findByRole('region', { name: 'Набор a' })
    vi.useFakeTimers()
    act(() => nearSet('Набор a'))
    act(() => vi.advanceTimersByTime(50))
    act(() => nearSet('Набор a', false))
    act(() => vi.advanceTimersByTime(500))
    vi.useRealTimers()
    expect(fetchCatalogStickerSet).not.toHaveBeenCalled()
  })

  it('сбой загрузки набора — повтор внутри раздела', async () => {
    vi.mocked(fetchCatalogStickerSet).mockRejectedValueOnce(new Error('boom'))
    renderTab()
    await screen.findByRole('region', { name: 'Набор a' })
    vi.useFakeTimers()
    act(() => nearSet('Набор a'))
    act(() => vi.advanceTimersByTime(200))
    vi.useRealTimers()

    const a = screen.getByRole('region', { name: 'Набор a' })
    await userEvent.click(await within(a).findByRole('button', { name: 'tgComposer.retry' }))
    expect(await within(a).findAllByRole('button', { name: 'tgComposer.stickerAlt' })).toHaveLength(
      2,
    )
  })
})
