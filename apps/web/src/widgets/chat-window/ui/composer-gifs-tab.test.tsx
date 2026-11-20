import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

const save = vi.fn()
const remove = vi.fn()

vi.mock('../../../entities/chat', () => ({
  composerKeys: {
    gifsRecent: () => ['gifs-recent'],
    gifsTrending: () => ['gifs-trending'],
    gifsSearch: (q: string) => ['gifs-search', q],
  },
  fetchRecentGifs: vi.fn(),
  fetchTrendingGifs: vi.fn(),
  searchGifs: vi.fn(),
  useSavedGifs: vi.fn(),
  useSavedGifActions: () => ({ save: { mutate: save }, remove: { mutate: remove } }),
  GifVideo: ({ src }: { src: string }) => <video data-testid="gif-video" src={src} />,
}))

import { fetchRecentGifs, fetchTrendingGifs, useSavedGifs } from '../../../entities/chat'
import { GifsTab, gridCorners } from './composer-gifs-tab'

const mp4 = (fileId: string, fingerprint = `${fileId}:1:1`) => ({
  fileId,
  mime: 'video/mp4',
  animation: true,
  width: 100,
  height: 80,
  url: `https://s3/${fileId}.mp4`,
  poster: null,
  placeholder: null,
  expiresAt: '2026-11-18T10:15:00Z',
  fingerprint,
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onPick = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  render(<GifsTab onPick={onPick} />, { wrapper })
  return { onPick }
}

beforeAll(() => {
  // jsdom без IntersectionObserver: панель подгружает каталог по нему.
  globalThis.IntersectionObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  } as unknown as typeof IntersectionObserver
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSavedGifs).mockReturnValue({
    data: [{ ...mp4('saved-1', 'same'), id: 'sg-1', sourceFileId: 'src', createdAt: '' }],
  } as never)
  vi.mocked(fetchRecentGifs).mockResolvedValue([mp4('recent-1'), mp4('dup', 'same')])
})

describe('Вкладка GIF', () => {
  it('без ключа GIPHY: поиск и подпись GIPHY скрыты, сохранённые и недавние работают', async () => {
    vi.mocked(fetchTrendingGifs).mockRejectedValue({ code: 'FEATURE_DISABLED' })
    const { onPick } = setup()

    expect(await screen.findByRole('region', { name: 'tgGifs.saved' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'tgGifs.recent' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument())
    expect(screen.queryByText('tgGifs.poweredBy')).not.toBeInTheDocument()
    // Недавний, который уже сохранён (тот же отпечаток), второй раз не показывается.
    expect(screen.getAllByTestId('gif-video').map((v) => v.getAttribute('src'))).toEqual([
      'https://s3/saved-1.mp4',
      'https://s3/recent-1.mp4',
    ])

    await userEvent.click(screen.getAllByRole('button', { name: 'tgComposer.gifSend' })[0]!)
    expect(onPick).toHaveBeenCalledWith({ kind: 'recent', fileId: 'saved-1' })
  })

  it('с ключом: поиск, «Powered by GIPHY» и каталог после своих', async () => {
    vi.mocked(fetchTrendingGifs).mockResolvedValue({
      items: [
        {
          id: 'g1',
          title: 'Cat',
          width: 200,
          height: 100,
          previewUrl: 'https://media.giphy.com/g1.gif',
          previewWidth: 200,
          previewHeight: 100,
        },
      ],
      nextOffset: null,
    })
    const { onPick } = setup()

    expect(await screen.findByRole('searchbox')).toBeInTheDocument()
    expect(screen.getByText('tgGifs.poweredBy')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Cat' }))
    expect(onPick).toHaveBeenCalledWith({ kind: 'catalog', id: 'g1' })
  })

  it('правый клик: сохранённый — убрать, недавний — сохранить', async () => {
    vi.mocked(fetchTrendingGifs).mockRejectedValue({ code: 'FEATURE_DISABLED' })
    setup()
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'tgComposer.gifSend' })).toHaveLength(2),
    )
    const tiles = screen.getAllByRole('button', { name: 'tgComposer.gifSend' })
    await userEvent.pointer({ keys: '[MouseRight]', target: tiles[0]! })
    expect(remove).toHaveBeenCalledWith('sg-1')
    const again = screen.getAllByRole('button', { name: 'tgComposer.gifSend' })
    await userEvent.pointer({ keys: '[MouseRight]', target: again[1]! })
    expect(save).toHaveBeenCalledWith('recent-1')
  })

  it('крестик в поиске очищает запрос', async () => {
    vi.mocked(fetchTrendingGifs).mockResolvedValue({ items: [], nextOffset: null })
    setup()
    const box = await screen.findByRole('searchbox')
    await userEvent.type(box, 'cat')
    await userEvent.click(screen.getByRole('button', { name: 'tgEmoji.clearSearch' }))
    expect(box).toHaveValue('')
  })
})

describe('Скругление углов сетки GIF', () => {
  const corners = (total: number) =>
    Array.from({ length: total }, (_, i) => {
      const c = gridCorners(i, total)
      return [c.topStart, c.topEnd, c.bottomStart, c.bottomEnd]
        .map((on, k) => (on ? ['tl', 'tr', 'bl', 'br'][k] : ''))
        .join('')
    })

  it('полные ряды: углы только у четырёх крайних плиток', () => {
    expect(corners(6)).toEqual(['tl', '', 'tr', 'bl', '', 'br'])
  })

  it('неполный последний ряд: нижний правый угол и у края предпоследнего ряда', () => {
    expect(corners(5)).toEqual(['tl', '', 'trbr', 'bl', 'br'])
  })

  it('одна плитка — скруглена со всех сторон, один ряд — сверху и снизу', () => {
    expect(corners(1)).toEqual(['tltrblbr'])
    expect(corners(2)).toEqual(['tlbl', 'trbr'])
  })
})
