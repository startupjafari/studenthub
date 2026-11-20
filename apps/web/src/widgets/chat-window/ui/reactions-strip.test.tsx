import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MessageReaction } from '../../../entities/chat'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: { emoji?: string }) => (v?.emoji ? `${k}:${v.emoji}` : k),
}))

import { ReactionsStrip } from './reactions-strip'

const user = (id: string) =>
  ({ id, firstName: 'И', lastName: 'Ф', avatarUrl: null }) as MessageReaction['user']
const reaction = (emoji: string, userId: string) =>
  ({ emoji, userId, user: user(userId) }) as MessageReaction

const chip = (emoji: string) =>
  screen.getByRole('button', { name: `tgBehavior.reactionChip:${emoji}` })

describe('ReactionsStrip', () => {
  // Строка ленты, смонтированная с готовыми реакциями, не проигрывает их появление.
  it('реакции, бывшие при монтировании, стоят без анимации, новые — въезжают', () => {
    const props = { myId: 'me', ownBubble: false, onToggle: vi.fn() }
    const { rerender } = render(<ReactionsStrip {...props} reactions={[reaction('👍', 'u1')]} />)
    expect(chip('👍').className).not.toContain('animate-in')
    rerender(<ReactionsStrip {...props} reactions={[reaction('👍', 'u1'), reaction('🔥', 'u2')]} />)
    expect(chip('👍').className).not.toContain('animate-in')
    expect(chip('🔥').className).toContain('animate-in')
  })

  it('первая реакция у уже показанного сообщения въезжает', () => {
    render(
      <ReactionsStrip
        myId="me"
        ownBubble={false}
        onToggle={vi.fn()}
        animateFromStart
        reactions={[reaction('👍', 'u1')]}
      />,
    )
    expect(chip('👍').className).toContain('animate-in')
  })
})
