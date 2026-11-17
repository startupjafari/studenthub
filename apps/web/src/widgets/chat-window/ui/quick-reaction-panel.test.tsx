import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CHAT_REACTION_EMOJIS, DEFAULT_CHAT_REACTION } from '@studenthub/shared-config'

// next-intl → ключ как есть (с эмодзи для ключей с параметром).
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: { emoji?: string }) => (v?.emoji ? `${k}:${v.emoji}` : k),
}))

import { QuickReactionPanel } from './quick-reaction-panel'

function setup(value: string) {
  const onChange = vi.fn()
  render(
    <QuickReactionPanel
      embedded
      hidden={false}
      value={value}
      onChange={onChange}
      onClose={vi.fn()}
    />,
  )
  return { onChange }
}

describe('QuickReactionPanel', () => {
  it('отмечает текущую быструю реакцию', () => {
    setup('👍')
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(CHAT_REACTION_EMOJIS.length)
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toContain('👍')
  })

  it('своя реакция вне набора — первой клеткой и отмечена', () => {
    setup('🦄')
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(CHAT_REACTION_EMOJIS.length + 1)
    expect(radios[0]?.textContent).toContain('🦄')
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
  })

  it('выбор общей по умолчанию уходит как null, остальные — эмодзи', async () => {
    const { onChange } = setup('👍')
    await userEvent.click(
      screen.getByRole('radio', { name: `tgReactions.quickDefaultLabel:${DEFAULT_CHAT_REACTION}` }),
    )
    expect(onChange).toHaveBeenLastCalledWith(null)
    await userEvent.click(screen.getByRole('radio', { name: '❤️' }))
    expect(onChange).toHaveBeenLastCalledWith('❤️')
  })
})
