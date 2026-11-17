import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../entities/chat', () => ({ forwardBatchRequest: vi.fn() }))

import { forwardBatchRequest, type ChatMessage } from '../../../entities/chat'
import { forwardRequestId, hasForwardCaptions, useForwardDraft } from './use-forward-draft'

const send = vi.mocked(forwardBatchRequest)

function msg(id: string, at: string, patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    seq: 1,
    createdAt: at,
    content: 'текст',
    media: [],
    sender: { id: 'u2', firstName: 'Айгерим', lastName: 'Серикова', avatarUrl: null },
    ...patch,
  } as unknown as ChatMessage
}

const later = msg('m2', '2026-11-17T10:02:00Z')
const earlier = msg('m1', '2026-11-17T10:01:00Z', {
  media: [{ id: 'f1' }] as unknown as ChatMessage['media'],
  content: 'подпись',
})

function setup(activeId = 'c2', replyToId?: string) {
  const onError = vi.fn()
  const hook = renderHook(
    (p: { activeId: string; replyToId?: string }) =>
      useForwardDraft({
        activeId: p.activeId,
        replyToId: p.replyToId,
        editingId: undefined,
        onError,
      }),
    { initialProps: { activeId, replyToId } },
  )
  return { ...hook, onError }
}

describe('useForwardDraft — пересылка над полем ввода (П.32)', () => {
  beforeEach(() => send.mockReset())

  it('плашка только в целевом чате, сообщения по времени', () => {
    const { result, rerender } = setup('c2')
    act(() => result.current.start('c2', [later, earlier]))
    expect(result.current.active?.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    rerender({ activeId: 'c3', replyToId: undefined })
    expect(result.current.active).toBeNull()
    expect(result.current.draft).not.toBeNull()
  })

  it('скрыть подписи скрывает и имя; показать имя возвращает подписи', () => {
    const { result } = setup()
    act(() => result.current.start('c2', [earlier]))
    act(() => result.current.toggleCaptions())
    expect(result.current.draft).toMatchObject({ hideCaptions: true, hideSender: true })
    act(() => result.current.toggleSender())
    expect(result.current.draft).toMatchObject({ hideCaptions: false, hideSender: false })
  })

  it('отправка — одна пачка с комментарием и флагами; удачная снимает плашку', async () => {
    send.mockResolvedValue([{ chatId: 'c2', ok: true, messageIds: ['x'] }])
    const { result } = setup()
    act(() => result.current.start('c2', [later, earlier]))
    act(() => result.current.toggleSender())
    let ok = false
    await act(async () => {
      ok = await result.current.send({ comment: 'смотри https://a.example', noLinkPreview: true })
    })
    expect(ok).toBe(true)
    expect(send).toHaveBeenCalledWith({
      messageIds: ['m1', 'm2'],
      chatIds: ['c2'],
      comment: 'смотри https://a.example',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      hideSender: true,
      noLinkPreview: true,
    })
    expect(result.current.draft).toBeNull()
  })

  it('отказ сервера — ошибка показана, плашка остаётся для повтора', async () => {
    send.mockResolvedValue([{ chatId: 'c2', ok: false, messageIds: [], code: 'FORBIDDEN' }])
    const { result, onError } = setup()
    act(() => result.current.start('c2', [later]))
    let ok = true
    await act(async () => {
      ok = await result.current.send({ comment: '' })
    })
    expect(ok).toBe(false)
    expect(onError).toHaveBeenCalledWith('FORBIDDEN')
    expect(result.current.draft).not.toBeNull()
  })

  it('ответ в целевом чате заменяет пересылку', () => {
    const { result, rerender } = setup('c2')
    act(() => result.current.start('c2', [later]))
    rerender({ activeId: 'c2', replyToId: 'm9' })
    expect(result.current.draft).toBeNull()
  })

  it('подписи есть только у сообщений с вложениями и текстом', () => {
    expect(hasForwardCaptions([later])).toBe(false)
    expect(hasForwardCaptions([earlier])).toBe(true)
  })

  it('requestId — uuid, как требует схема', () => {
    expect(forwardRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
