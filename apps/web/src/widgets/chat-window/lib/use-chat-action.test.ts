import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTION_REPEAT_MS } from './chat-actions'
import { useChatActionSender } from './use-chat-action'

type Sent = [chatId: string, action: string | null]

function setup() {
  const sent: Sent[] = []
  const { result, unmount } = renderHook(() =>
    useChatActionSender((chatId, action) => sent.push([chatId, action])),
  )
  return { sent, sender: result.current, unmount }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ping — действие подтверждает сам человек', () => {
  it('первое нажатие уходит сразу', () => {
    const { sent, sender } = setup()
    sender.ping('c1', 'TYPING')
    expect(sent).toEqual([['c1', 'TYPING']])
  })

  it('частые нажатия не заваливают сокет', () => {
    const { sent, sender } = setup()
    for (let i = 0; i < 20; i++) {
      sender.ping('c1', 'TYPING')
      vi.advanceTimersByTime(50)
    }
    expect(sent).toHaveLength(1)
  })

  it('через окно повтора подтверждение уходит снова', () => {
    const { sent, sender } = setup()
    sender.ping('c1', 'TYPING')
    vi.advanceTimersByTime(ACTION_REPEAT_MS)
    sender.ping('c1', 'TYPING')
    expect(sent).toEqual([
      ['c1', 'TYPING'],
      ['c1', 'TYPING'],
    ])
  })

  it('сам по себе не повторяется: перестал печатать — перестали слать', () => {
    // Подпись у получателя гаснет по таймауту, и это дешевле лишнего события.
    const { sent, sender } = setup()
    sender.ping('c1', 'TYPING')
    vi.advanceTimersByTime(ACTION_REPEAT_MS * 5)
    expect(sent).toHaveLength(1)
  })

  it('смена чата сообщается сразу, не дожидаясь окна', () => {
    const { sent, sender } = setup()
    sender.ping('c1', 'TYPING')
    sender.ping('c2', 'TYPING')
    expect(sent).toEqual([
      ['c1', 'TYPING'],
      ['c2', 'TYPING'],
    ])
  })

  it('смена действия сообщается сразу', () => {
    const { sent, sender } = setup()
    sender.ping('c1', 'TYPING')
    sender.ping('c1', 'RECORDING_VOICE')
    expect(sent).toEqual([
      ['c1', 'TYPING'],
      ['c1', 'RECORDING_VOICE'],
    ])
  })
})

describe('begin/end — действие длится само', () => {
  it('подтверждается по таймеру, пока не закончится', () => {
    const { sent, sender } = setup()
    sender.begin('c1', 'RECORDING_VOICE')
    vi.advanceTimersByTime(ACTION_REPEAT_MS * 3)
    expect(sent).toHaveLength(4) // старт + три подтверждения
    expect(sent.every(([, a]) => a === 'RECORDING_VOICE')).toBe(true)
  })

  it('end останавливает повторы и шлёт «закончил»', () => {
    const { sent, sender } = setup()
    sender.begin('c1', 'UPLOADING_FILE')
    vi.advanceTimersByTime(ACTION_REPEAT_MS)
    sender.end()
    const afterEnd = sent.length
    vi.advanceTimersByTime(ACTION_REPEAT_MS * 5)
    expect(sent[sent.length - 1]).toEqual(['c1', null])
    expect(sent).toHaveLength(afterEnd)
  })

  it('повторный begin того же действия не плодит таймеры', () => {
    const { sent, sender } = setup()
    sender.begin('c1', 'UPLOADING_PHOTO')
    sender.begin('c1', 'UPLOADING_PHOTO')
    vi.advanceTimersByTime(ACTION_REPEAT_MS)
    expect(sent).toHaveLength(2) // старт + одно подтверждение, а не два таймера
  })

  it('end без активного действия ничего не шлёт', () => {
    const { sent, sender } = setup()
    sender.end()
    sender.end()
    expect(sent).toEqual([])
  })

  it('«закончил» уходит в тот чат, где действие началось', () => {
    // Иначе при переключении диалога стоп улетал бы в новый чат, а в старом подпись
    // висела бы до таймаута.
    const { sent, sender } = setup()
    sender.begin('c1', 'RECORDING_VOICE')
    sender.end()
    expect(sent[sent.length - 1]).toEqual(['c1', null])
  })

  it('загрузка после записи: смена действия не теряет «закончил»', () => {
    const { sent, sender } = setup()
    sender.begin('c1', 'RECORDING_VOICE')
    sender.begin('c1', 'UPLOADING_FILE')
    sender.end()
    expect(sent.map(([, a]) => a)).toEqual(['RECORDING_VOICE', 'UPLOADING_FILE', null])
  })
})
