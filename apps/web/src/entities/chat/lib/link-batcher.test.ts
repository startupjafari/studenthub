import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkMissingError, createLinkBatcher } from './link-batcher'

// Ответ сервера: ссылка на каждый запрошенный id, кроме перечисленных.
function serverWithout(...missing: string[]) {
  return vi.fn((ids: string[]) =>
    Promise.resolve(
      new Map(ids.filter((id) => !missing.includes(id)).map((id) => [id, `u-${id}`])),
    ),
  )
}

describe('createLinkBatcher — ссылки на вложения пачкой', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('просьбы за одно окно уходят одним запросом, каждый получает своё', async () => {
    const fetchMany = serverWithout()
    const load = createLinkBatcher({ fetchMany, windowMs: 20 })
    const a = load('a')
    await vi.advanceTimersByTimeAsync(10)
    const b = load('b')
    expect(fetchMany).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    expect(fetchMany).toHaveBeenCalledTimes(1)
    expect(fetchMany).toHaveBeenCalledWith(['a', 'b'])
    await expect(a).resolves.toBe('u-a')
    await expect(b).resolves.toBe('u-b')
  })

  it('после отправки окно открывается заново — следующая просьба идёт новой пачкой', async () => {
    const fetchMany = serverWithout()
    const load = createLinkBatcher({ fetchMany, windowMs: 20 })
    void load('a')
    await vi.advanceTimersByTimeAsync(20)
    void load('b')
    await vi.advanceTimersByTimeAsync(20)
    expect(fetchMany.mock.calls).toEqual([[['a']], [['b']]])
  })

  it('один файл дважды за окно — один id в запросе, ответ обоим', async () => {
    const fetchMany = serverWithout()
    const load = createLinkBatcher({ fetchMany })
    const first = load('a')
    const second = load('a')
    await vi.advanceTimersByTimeAsync(20)
    expect(fetchMany).toHaveBeenCalledWith(['a'])
    await expect(first).resolves.toBe('u-a')
    await expect(second).resolves.toBe('u-a')
  })

  it('больше потолка — несколько запросов по потолку, полная пачка уходит без ожидания', async () => {
    const fetchMany = serverWithout()
    const load = createLinkBatcher({ fetchMany, maxBatch: 50, windowMs: 20 })
    const all = Array.from({ length: 120 }, (_, i) => load(`f${i}`))
    // Две полные пачки ушли сразу, хвост ждёт окна.
    expect(fetchMany).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(20)
    expect(fetchMany).toHaveBeenCalledTimes(3)
    expect(fetchMany.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 20])
    expect(new Set(fetchMany.mock.calls.flatMap(([ids]) => ids)).size).toBe(120)
    await expect(Promise.all(all)).resolves.toHaveLength(120)
  })

  it('нет в ответе — ошибка только этому вызывающему', async () => {
    const fetchMany = serverWithout('gone')
    const load = createLinkBatcher({ fetchMany })
    const ok = load('a')
    // Обработчик вешаем сразу: отказ приходит, пока тест крутит таймеры.
    const gone = load('gone').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(20)
    await expect(ok).resolves.toBe('u-a')
    expect(await gone).toBeInstanceOf(LinkMissingError)
  })

  it('упал весь запрос — ошибка всем из пачки, соседняя пачка не задета', async () => {
    const error = new Error('429')
    const fetchMany = vi.fn((ids: string[]) =>
      ids.includes('a')
        ? Promise.reject(error)
        : Promise.resolve(new Map(ids.map((id) => [id, `u-${id}`]))),
    )
    const load = createLinkBatcher({ fetchMany, maxBatch: 2 })
    const results = ['a', 'b', 'c'].map((id) => load(id).then(String, (e: unknown) => e))
    await vi.advanceTimersByTimeAsync(20)
    expect(await Promise.all(results)).toEqual([error, error, 'u-c'])
  })
})
