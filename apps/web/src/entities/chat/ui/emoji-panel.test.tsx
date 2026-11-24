import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))

// Каталог — крошечный, без сети: по смайлу в «людях» и «животных».
vi.mock('frimousse', () => ({
  defaultEmojiDataResolver: () =>
    Promise.resolve({
      emojis: [
        { emoji: '😀', category: 0, label: 'улыбка', version: 1, tags: [] },
        { emoji: '🐱', category: 3, label: 'кот', version: 1, tags: ['кошка'] },
      ],
      categories: [
        { index: 0, label: 'Смайлики и эмоции' },
        { index: 3, label: 'Животные и природа' },
      ],
    }),
}))

vi.mock('../../../shared/lib/emoji-support', () => ({ isEmojiSupported: () => true }))

import { EmojiPanel } from './emoji-panel'

beforeAll(() => {
  // jsdom не прокручивает элементы: полоса разделов и лента зовут scrollTo.
  Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('Вкладка эмодзи', () => {
  it('выбор эмодзи вставляет его и запоминает первым в «Недавних»', async () => {
    const onPick = vi.fn()
    render(<EmojiPanel variant="popover" onPick={onPick} />)
    const nature = await screen.findByRole('region', { name: 'Животные и природа' })
    await userEvent.click(within(nature).getByRole('button', { name: '🐱' }))
    expect(onPick).toHaveBeenCalledWith('🐱')
    expect(JSON.parse(window.localStorage.getItem('chat:recent-emoji') ?? '[]')[0]).toBe('🐱')
  })

  it('полоса: «Недавние» подсвечены, разделы свёрнуты в пилюлю', async () => {
    render(<EmojiPanel variant="popover" onPick={() => {}} />)
    const recent = await screen.findByRole('button', { name: 'tgEmoji.recent' })
    expect(recent).toHaveAttribute('aria-pressed', 'true')
    // Свёрнутая пилюля — одна кнопка в порядке Tab: остальные разделы скрыты.
    expect(screen.getByRole('button', { name: 'tgEmoji.people' })).not.toHaveAttribute('tabindex')
    expect(screen.getByRole('button', { name: 'Животные и природа' })).toHaveAttribute(
      'tabindex',
      '-1',
    )
  })

  it('поиск показывает выдачу, крестик и Escape очищают запрос', async () => {
    render(<EmojiPanel variant="popover" onPick={() => {}} />)
    await screen.findByRole('region', { name: 'Животные и природа' })
    const box = screen.getByRole('searchbox')
    await userEvent.type(box, 'кош')
    const results = screen.getByRole('region', { name: 'tgEmoji.searchResults' })
    expect(within(results).getByRole('button', { name: '🐱' })).toBeInTheDocument()
    expect(within(results).queryByRole('button', { name: '😀' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'tgEmoji.clearSearch' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()

    await userEvent.type(box, 'zzz')
    expect(screen.getByText('tgEmoji.nothingFound')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(box).toHaveValue('')
  })
})
