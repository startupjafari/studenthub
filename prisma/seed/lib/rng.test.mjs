// Воспроизводимость: сид обязан давать одни и те же данные между прогонами, иначе
// повторный запуск переписывает «те же» строки другими значениями. Плюс независимость
// генераторов вузов — от неё зависит догенерация порциями и параллельный прогон.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SEED_BASE, makeRandom, universityRandom } from './rng.mjs'

describe('PRNG', () => {
  it('два генератора с одним зерном дают одну последовательность', () => {
    const a = makeRandom(SEED_BASE)
    const b = makeRandom(SEED_BASE)
    const left = Array.from({ length: 50 }, () => a.randInt(0, 1e9))
    const right = Array.from({ length: 50 }, () => b.randInt(0, 1e9))
    assert.deepEqual(left, right)
  })

  it('генератор вуза зависит только от его индекса', () => {
    assert.equal(universityRandom(7).randInt(0, 1e9), universityRandom(7).randInt(0, 1e9))
    assert.notEqual(universityRandom(7).randInt(0, 1e9), universityRandom(8).randInt(0, 1e9))
  })

  it('randInt не выходит из границ и включает края', () => {
    const r = makeRandom(1)
    const seen = new Set()
    for (let i = 0; i < 5000; i += 1) {
      const v = r.randInt(3, 5)
      assert.ok(v >= 3 && v <= 5, `вышли из диапазона: ${v}`)
      seen.add(v)
    }
    assert.deepEqual([...seen].sort(), [3, 4, 5])
  })

  it('sample отдаёт запрошенное число РАЗНЫХ элементов', () => {
    const r = makeRandom(2)
    const pool = Array.from({ length: 25 }, (_, i) => i)
    for (let i = 0; i < 200; i += 1) {
      const picked = r.sample(pool, 5)
      assert.equal(picked.length, 5)
      assert.equal(new Set(picked).size, 5, 'повтор сломал бы уникальные индексы голосов и реакций')
    }
  })

  it('sample не падает, когда просят больше, чем есть', () => {
    assert.equal(makeRandom(3).sample([1, 2], 10).length, 2)
  })

  it('pickWeighted возвращает только заявленные значения и уважает веса', () => {
    const r = makeRandom(4)
    const counts = { PRESENT: 0, ABSENT: 0 }
    for (let i = 0; i < 4000; i += 1) {
      counts[
        r.pickWeighted([
          ['PRESENT', 90],
          ['ABSENT', 10],
        ])
      ] += 1
    }
    assert.ok(counts.PRESENT > counts.ABSENT * 4, `перекос не соблюдён: ${JSON.stringify(counts)}`)
  })

  it('даты считаются от «сейчас» — окна дашбордов не должны уезжать в прошлое', () => {
    const r = makeRandom(5)
    const past = r.daysFromNow(-7).getTime()
    const now = Date.now()
    assert.ok(past < now && now - past > 6 * 86_400_000)
    const inRange = r.randomDate(-10, -1).getTime()
    assert.ok(inRange < now && inRange > now - 11 * 86_400_000)
  })
})
