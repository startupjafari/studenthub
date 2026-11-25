import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PostMedia } from '../../../entities/post'

// next-intl → ключ (с параметрами — через «|»), сами кадры — заглушки: проверяется раскладка.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, p?: Record<string, unknown>) =>
    p ? `${k}|${Object.values(p).join('/')}` : k,
}))
vi.mock('./post-media', () => ({ PostMediaView: () => <span data-testid="tile" /> }))
vi.mock('./media-frame', () => ({ MediaFrame: () => <span data-testid="frame" /> }))

import { PostGallery } from './post-gallery'

const media = (id: string, width: number, height: number, mime = 'image/jpeg'): PostMedia => ({
  id,
  mime,
  width,
  height,
})

function renderGallery(items: PostMedia[], onOpen = vi.fn()) {
  render(<PostGallery postId="p1" media={items} onOpen={onOpen} tileRef={() => undefined} />)
  return onOpen
}

describe('PostGallery — раскладка по пропорциям', () => {
  it('одно вложение — целиком в своей оправе', () => {
    renderGallery([media('a', 1200, 800)])
    expect(screen.getAllByTestId('frame')).toHaveLength(1)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('горизонтальные фото (до четырёх) — компактной сеткой', () => {
    renderGallery([media('a', 1200, 800), media('b', 1600, 900), media('c', 1000, 1000)])
    expect(screen.getAllByTestId('tile')).toHaveLength(3)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('вертикальные снимки — каруселью, а не сеткой, которая растягивает карточку', () => {
    renderGallery([media('a', 800, 1200), media('b', 800, 1200)])
    expect(screen.getByRole('group')).toHaveAttribute('aria-roledescription', 'carousel')
  })

  it('графика (PNG) — каруселью: текст на схеме не обрезается', () => {
    renderGallery([media('a', 800, 450, 'image/png'), media('b', 1200, 800)])
    expect(screen.getByRole('group')).toBeInTheDocument()
  })

  it('пять и больше — карусель со счётчиком; стрелки клавиатуры листают, кадр открывается', async () => {
    const onOpen = renderGallery(Array.from({ length: 6 }, (_, i) => media(`m${i}`, 1200, 800)))
    const gallery = screen.getByRole('group')
    expect(screen.getByText('1/6')).toBeInTheDocument()
    // В DOM — текущий кадр и соседи, остальные не грузятся.
    expect(screen.getAllByTestId('frame')).toHaveLength(2)

    gallery.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByText('2/6')).toBeInTheDocument()
    expect(gallery).toHaveAttribute('aria-label', 'mediaPosition|2/6')

    await userEvent.click(screen.getByRole('button', { name: 'openMedia · 2/6' }))
    expect(onOpen).toHaveBeenCalledWith(1)
  })
})
