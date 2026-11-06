import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }))
const auth = { user: { id: 'me' }, role: 'STUDENT' }
vi.mock('../../../shared/store', () => ({
  useAppSelector: (pick: (s: { auth: typeof auth }) => unknown) => pick({ auth }),
}))
vi.mock('../../../entities/story/api/story-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/story/api/story-api')>()
  return {
    ...actual,
    createStoryRequest: vi.fn().mockResolvedValue({ id: 's-1' }),
    uploadStoryMedia: vi.fn(),
  }
})

import { createStoryRequest, uploadStoryMedia } from '../../../entities/story'
import { CreateStoryForm } from './create-story-form'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<CreateStoryForm />, { wrapper })
  return userEvent.setup()
}

afterEach(() => vi.clearAllMocks())

describe('Редактор сторис', () => {
  it('текст добавляется на кадр, правится в свойствах и уходит в публикацию элементом', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Текст' }))
    const field = screen.getByRole('textbox', { name: 'Текст элемента' })
    await user.clear(field)
    await user.type(field, 'Привет, группа')
    await user.click(screen.getByRole('button', { name: 'Жёлтый' }))
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))
    await waitFor(() => expect(createStoryRequest).toHaveBeenCalled())
    const input = vi.mocked(createStoryRequest).mock.calls[0]![0]
    expect(input.elements).toEqual([
      expect.objectContaining({ type: 'text', text: 'Привет, группа', color: '#facc15' }),
    ])
    // Локальный id редактора на сервер не уходит.
    expect(input.elements?.[0]).not.toHaveProperty('id')
  })

  it('пустой кадр не публикуется', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Опубликовать' }))
    expect(await screen.findByText(ru.Stories.needContent)).toBeInTheDocument()
    expect(createStoryRequest).not.toHaveBeenCalled()
  })

  it('неподходящий формат отклоняется до загрузки', async () => {
    setup()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    })
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(ru.Stories.badFormat))
    expect(uploadStoryMedia).not.toHaveBeenCalled()
  })

  it('новый текст сразу правится на кадре, Esc завершает правку', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Текст' }))
    expect(screen.getByRole('textbox', { name: ru.Stories.editOnCanvas })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: ru.Stories.editOnCanvas })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /на кадре/ })).toBeInTheDocument()
  })

  it('элемент на кадре удаляется клавишей Delete', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Текст' }))
    await user.keyboard('{Escape}')
    const onFrame = screen.getByRole('button', { name: /на кадре/ })
    onFrame.focus()
    await user.keyboard('{Delete}')
    expect(screen.queryByRole('button', { name: /на кадре/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Текст элемента' })).not.toBeInTheDocument()
  })

  it('добавление элемента отменяется и повторяется', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Текст' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: ru.Stories.undoEdit }))
    expect(screen.queryByRole('button', { name: /на кадре/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ru.Stories.redo }))
    expect(screen.getByRole('button', { name: /на кадре/ })).toBeInTheDocument()
  })

  it('выбранный элемент дублируется из панели настроек', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Текст' }))
    await user.keyboard('{Escape}')
    screen.getByRole('button', { name: /на кадре/ }).focus()
    await user.click(screen.getByRole('button', { name: ru.Stories.duplicate }))
    expect(screen.getAllByRole('button', { name: /на кадре/ })).toHaveLength(2)
  })
})
