// Идентификаторы — механизм идемпотентности сида: id зависит только от места сущности
// в структуре. Полный прогон однажды упал именно из-за нарушения этого принципа
// (username собирался из случайной фамилии и позиционного счётчика), поэтому здесь
// проверяется в первую очередь структурность и уникальность.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { child, emailFor, id, uniPrefix, universityId, usernameFor } from './ids.mjs'

describe('идентификаторы', () => {
  it('префикс вуза сохраняет числовой порядок при лексикографической сортировке', () => {
    const sorted = [10, 7, 100, 1].map(uniPrefix).sort()
    assert.deepEqual(sorted, ['u001', 'u007', 'u010', 'u100'])
  })

  it('id вуза детерминирован и не совпадает с демо-вузом', () => {
    assert.equal(universityId(42), 'u042')
    assert.notEqual(universityId(1), 'seed-university-001')
  })

  it('id сущности собирается из места в структуре', () => {
    assert.equal(id(42, 'f', 'eco'), 'u042-f-eco')
    assert.equal(child('u042-f-eco-g3', 'st', '07'), 'u042-f-eco-g3-st-07')
  })

  it('email уникален внутри вуза и разный между вузами', () => {
    const a = emailFor(1, 'g.it.1.st.00')
    const b = emailFor(2, 'g.it.1.st.00')
    assert.notEqual(a, b)
    assert.match(a, /@u001\.edu\.kz$/)
  })

  it('username чистится до допустимых символов и разводится по вузам', () => {
    const name = usernameFor(42, 'Ospanova.G-IT-1-st-00')
    assert.equal(name, name.toLowerCase())
    assert.match(name, /^[a-z0-9._]+$/)
    assert.notEqual(usernameFor(1, 'ospanova'), usernameFor(2, 'ospanova'))
  })

  it('id студентов уникальны по всей выборке вузов и групп', () => {
    const all = new Set()
    let total = 0
    for (let uni = 1; uni <= 20; uni += 1) {
      for (const fac of ['it', 'eco', 'law']) {
        for (let g = 0; g < 4; g += 1) {
          const groupId = id(uni, 'g', fac, g)
          for (let st = 0; st < 25; st += 1) {
            all.add(child(groupId, 'st', String(st).padStart(2, '0')))
            total += 1
          }
        }
      }
    }
    assert.equal(all.size, total, 'коллизия id означала бы молча пропущенные строки')
  })
})
