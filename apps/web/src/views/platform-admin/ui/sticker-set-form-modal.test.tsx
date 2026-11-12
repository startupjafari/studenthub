import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }))
vi.mock('../../../entities/sticker-set/api/sticker-set-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/sticker-set/api/sticker-set-api')>()
  return { ...actual, createStickerSetRequest: vi.fn(), updateStickerSetRequest: vi.fn() }
})

import { createStickerSetRequest, updateStickerSetRequest } from '../../../entities/sticker-set'
import type { AdminStickerSet } from '../../../entities/sticker-set'
import { StickerSetFormModal } from './sticker-set-form-modal'

const set: AdminStickerSet = {
  id: 's1',
  title: 'Котики',
  slug: 'cats',
  order: 0,
  isPublished: false,
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  stickers: [],
}

function setup(props: { set?: AdminStickerSet } = {}) {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<StickerSetFormModal {...props} onClose={onClose} />, { wrapper })
  return { onClose }
}

afterEach(() => vi.clearAllMocks())

describe('StickerSetFormModal — создание', () => {
  it('пустое название и негодный slug — ошибки у полей, запроса нет', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Короткое имя'), 'Котики!')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(await screen.findByText('Введите название')).toBeInTheDocument()
    expect(screen.getByText(/Короткое имя: латиница, цифры/)).toBeInTheDocument()
    expect(createStickerSetRequest).not.toHaveBeenCalled()
  })

  it('годные поля уходят на сервер, окно закрывается', async () => {
    vi.mocked(createStickerSetRequest).mockResolvedValue(set)
    const { onClose } = setup()
    await userEvent.type(screen.getByLabelText('Название'), 'Котики')
    await userEvent.type(screen.getByLabelText('Короткое имя'), 'cats_2026')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(createStickerSetRequest).mock.calls[0]?.[0]).toEqual({
      title: 'Котики',
      slug: 'cats_2026',
    })
  })

  it('занятый slug (409) — ошибка у поля, окно не закрывается', async () => {
    vi.mocked(createStickerSetRequest).mockRejectedValue({ code: 'CONFLICT', message: '' })
    const { onClose } = setup()
    await userEvent.type(screen.getByLabelText('Название'), 'Котики')
    await userEvent.type(screen.getByLabelText('Короткое имя'), 'cats')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(await screen.findByText('Это короткое имя уже занято')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('StickerSetFormModal — переименование', () => {
  it('slug не редактируется, новое название уходит PATCH-ем', async () => {
    vi.mocked(updateStickerSetRequest).mockResolvedValue({ ...set, title: 'Коты' })
    const { onClose } = setup({ set })
    expect(screen.queryByLabelText('Короткое имя')).toBeNull()
    const title = screen.getByLabelText('Название')
    await userEvent.clear(title)
    await userEvent.type(title, 'Коты')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateStickerSetRequest).toHaveBeenCalledWith('s1', { title: 'Коты' })
  })

  it('без изменений — просто закрывается', async () => {
    const { onClose } = setup({ set })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateStickerSetRequest).not.toHaveBeenCalled()
  })
})
