import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRefreshCoalescer } from './refresh-coalescer'

describe('createRefreshCoalescer — склейка перезапросов', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('пачка «скоро» — один запуск, более ранний срок не сдвигается', async () => {
    const run = vi.fn()
    const c = createRefreshCoalescer(run)
    c.soon(300)
    c.soon(300)
    c.soon(1000)
    await vi.advanceTimersByTimeAsync(299)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('«когда затихнет» отодвигается событиями, но не дальше потолка', async () => {
    const run = vi.fn()
    const c = createRefreshCoalescer(run, { maxWaitMs: 2000 })
    c.settle(1000)
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(500)
      c.settle(1000)
    }
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('«скоро» поверх «когда затихнет» не ждёт затишья', async () => {
    const run = vi.fn()
    const c = createRefreshCoalescer(run)
    c.settle(1500)
    c.soon(300)
    c.settle(1500)
    await vi.advanceTimersByTimeAsync(300)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('не чаще минимального интервала', async () => {
    const run = vi.fn()
    const c = createRefreshCoalescer(run, { minIntervalMs: 1000 })
    c.soon(0)
    await vi.advanceTimersByTimeAsync(0)
    c.soon(0)
    await vi.advanceTimersByTimeAsync(999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('срок, вышедший во время запуска, даёт ещё один запуск после него', async () => {
    let finish: () => void = () => undefined
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue(undefined)
    const c = createRefreshCoalescer(run)
    c.soon(0)
    await vi.advanceTimersByTimeAsync(0)
    c.soon(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancel снимает назначенный запуск', async () => {
    const run = vi.fn()
    const c = createRefreshCoalescer(run)
    c.soon(100)
    c.cancel()
    await vi.advanceTimersByTimeAsync(500)
    expect(run).not.toHaveBeenCalled()
  })
})
