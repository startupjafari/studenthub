import { describe, expect, it, vi } from 'vitest'
import { AutosaveQueue, type AutosaveState } from './autosave-queue'

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AutosaveQueue', () => {
  it('пока летит сохранение, правки копятся и уходят одним запросом с последней версией', async () => {
    const calls: string[] = []
    const first = deferred()
    const save = vi.fn((v: string) => {
      calls.push(v)
      return calls.length === 1 ? first.promise : Promise.resolve()
    })
    const states: AutosaveState[] = []
    const q = new AutosaveQueue<string>({ save, onState: (s) => states.push(s) })

    q.push('v1', 'v1')
    const done = q.flush()
    q.push('v2', 'v2')
    q.push('v3', 'v3')
    // Второй flush не шлёт параллельный запрос — ждёт первый.
    void q.flush()
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve()
    await done
    await q.flush()
    expect(calls).toEqual(['v1', 'v3'])
    expect(states.at(-1)).toBe('saved')
  })

  it('уже сохранённую версию повторно не отправляет', async () => {
    const save = vi.fn(() => Promise.resolve())
    const q = new AutosaveQueue<string>({ save, onState: () => undefined })
    q.markSaved('k')
    q.push('same', 'k')
    await q.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('ошибка — состояние error; следующая правка уходит заново', async () => {
    const states: AutosaveState[] = []
    const save = vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValue(undefined)
    const q = new AutosaveQueue<string>({ save, onState: (s) => states.push(s) })
    q.push('a', 'a')
    await q.flush()
    expect(states.at(-1)).toBe('error')
    q.push('b', 'b')
    await q.flush()
    expect(save).toHaveBeenLastCalledWith('b')
    expect(states.at(-1)).toBe('saved')
  })

  it('stop ждёт летящее сохранение и больше ничего не отправляет', async () => {
    const pending = deferred()
    const save = vi.fn(() => pending.promise)
    const q = new AutosaveQueue<string>({ save, onState: () => undefined })
    q.push('a', 'a')
    void q.flush()
    let stopped = false
    const stopping = q.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    pending.resolve()
    await stopping
    q.push('b', 'b')
    await q.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
