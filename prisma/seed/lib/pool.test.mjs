// Пул воркеров: параллелизм и агрегация ошибок. Один упавший вуз не должен обрывать
// остальные — иначе на 70-м вузе прогон терял бы всю оставшуюся работу.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runPool } from './pool.mjs'

describe('runPool', () => {
  it('обрабатывает все элементы', async () => {
    const seen = []
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => void seen.push(n))
    assert.deepEqual(
      seen.sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7],
    )
  })

  it('держит заявленный предел одновременных задач', async () => {
    let running = 0
    let peak = 0
    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 1))
        running -= 1
      },
    )
    assert.ok(peak <= 4, `одновременно работало ${peak} воркеров вместо 4`)
  })

  it('доводит работу до конца, даже если часть задач упала', async () => {
    const done = []
    await assert.rejects(
      () =>
        runPool([1, 2, 3, 4], 2, async (n) => {
          if (n % 2 === 0) throw new Error(`bad ${n}`)
          done.push(n)
        }),
      /Не удалось сгенерировать 2 элем/,
    )
    assert.deepEqual(done.sort(), [1, 3], 'успешные элементы должны быть обработаны')
  })

  it('не падает на пустом списке', async () => {
    await runPool([], 4, async () => assert.fail('воркер не должен вызываться'))
  })
})
