import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import ru from '../../../messages/ru.json'
import { VideoPlayer } from './video-player'

function renderPlayer() {
  return render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <VideoPlayer src="/clip.mp4" inViewer />
    </NextIntlClientProvider>,
  )
}

describe('VideoPlayer: Esc при открытом меню', () => {
  // Так Esc ловит Radix Dialog просмотрщика — на документе в фазе захвата.
  const outer = vi.fn()
  afterEach(() => {
    document.removeEventListener('keydown', outer, true)
    outer.mockReset()
  })

  it('закрывает только меню скорости, а не слой под ним', async () => {
    document.addEventListener('keydown', outer, true)
    renderPlayer()
    await userEvent.click(screen.getByRole('button', { name: ru.Common.speed }))
    expect(screen.getByRole('menu', { name: ru.Common.speed })).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(outer).not.toHaveBeenCalled()
  })

  it('без открытого меню Esc уходит дальше — просмотрщик закрывается как раньше', () => {
    document.addEventListener('keydown', outer, true)
    renderPlayer()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(outer).toHaveBeenCalledOnce()
  })
})
