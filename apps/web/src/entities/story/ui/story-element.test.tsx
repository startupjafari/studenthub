import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StoryElementsLayer } from './story-element'

const place = { x: 0.5, y: 0.5, scale: 1, rotation: 0 }

describe('StoryElementsLayer', () => {
  it('отметка — кнопка в профиль, текст — своим цветом', async () => {
    const onMention = vi.fn()
    render(
      <StoryElementsLayer
        elements={[
          { type: 'mention', ...place, userId: 'u-7', name: 'Аня Ким' },
          {
            type: 'text',
            ...place,
            text: 'Встреча в 14:00',
            color: '#facc15',
            font: 'serif',
            align: 'center',
            background: 'none',
          },
        ]}
        onMention={onMention}
        mentionLabel={(name) => `Профиль ${name}`}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Профиль Аня Ким' }))
    expect(onMention).toHaveBeenCalledWith('u-7')
    expect(screen.getByText('Встреча в 14:00')).toHaveStyle({ color: '#facc15' })
  })

  it('без элементов слой не рисуется', () => {
    const { container } = render(<StoryElementsLayer elements={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
