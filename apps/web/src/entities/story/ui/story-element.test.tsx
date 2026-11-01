import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import ru from '../../../../messages/ru.json'
import { StoryElementsLayer } from './story-element'

const place = { x: 0.5, y: 0.5, scale: 1, rotation: 0 }

describe('StoryElementsLayer', () => {
  it('отметка — кнопка в профиль, текст — своим цветом', async () => {
    const onMention = vi.fn()
    render(
      <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
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
        />
      </NextIntlClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Профиль Аня Ким' }))
    expect(onMention).toHaveBeenCalledWith('u-7')
    expect(screen.getByText('Встреча в 14:00')).toHaveStyle({ color: '#facc15' })
  })

  it('без элементов слой не рисуется', () => {
    const { container } = render(<StoryElementsLayer elements={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('карточка события — название и действия; невидимое событие — «недоступно» без кнопок', () => {
    render(
      <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
        <StoryElementsLayer
          elements={[
            {
              type: 'event',
              ...place,
              eventId: 'e-1',
              event: {
                id: 'e-1',
                title: 'Хакатон ИТ',
                startsAt: '2026-11-05T09:00:00.000Z',
                endsAt: null,
                location: 'Ауд. 101',
                isOnline: false,
                isRegistered: false,
              },
            },
            { type: 'event', ...place, eventId: 'e-2', event: null },
          ]}
          cardActions={(e) => (e.type === 'event' && e.event ? <button>Участвовать</button> : null)}
        />
      </NextIntlClientProvider>,
    )
    expect(screen.getByText('Хакатон ИТ')).toBeInTheDocument()
    expect(screen.getByText('Ауд. 101')).toBeInTheDocument()
    expect(screen.getByText(ru.Stories.eventUnavailable)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Участвовать' })).toHaveLength(1)
  })
})
