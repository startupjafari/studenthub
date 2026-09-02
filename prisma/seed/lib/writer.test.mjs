// Регрессионные тесты буферной записи.
//
// Первый прогон полного сида упал на `grades_column_id_fkey`: буфер оценок набирал
// свои 2000 строк, когда колонки журнала ещё лежали в своём буфере. Тест на порядок
// флаша здесь — главный, остальное подпорки к нему.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWriter } from './writer.mjs'

// Мок Prisma: запоминает порядок вызовов createMany и размеры пачек.
function mockPrisma(models) {
  const calls = []
  const client = {}
  for (const name of models) {
    client[name] = {
      createMany: async ({ data, skipDuplicates }) => {
        calls.push({ model: name, count: data.length, skipDuplicates })
      },
    }
  }
  return { client, calls }
}

describe('createWriter', () => {
  it('пишет чанками заданного размера и считает строки', async () => {
    const { client, calls } = mockPrisma(['grade'])
    const writer = createWriter(client, { chunkSize: 100 })
    for (let i = 0; i < 250; i += 1) await writer.add('grade', { i })
    await writer.flush()

    assert.deepEqual(
      calls.map((c) => c.count),
      [100, 100, 50],
    )
    assert.equal(writer.counts.grade, 250)
    assert.equal(writer.written, 250)
  })

  it('всегда вставляет со skipDuplicates — на этом держится идемпотентность', async () => {
    const { client, calls } = mockPrisma(['grade'])
    const writer = createWriter(client, { chunkSize: 2 })
    await writer.add('grade', {})
    await writer.add('grade', {})
    assert.equal(calls[0].skipDuplicates, true)
  })

  it('при переполнении дочерней модели сначала дописывает родительскую', async () => {
    const { client, calls } = mockPrisma(['gradeColumn', 'grade'])
    const writer = createWriter(client, { chunkSize: 3 })

    // Так это и выглядит в шаге академики: колонка, затем оценки по ней.
    await writer.add('gradeColumn', { id: 'c1' })
    await writer.add('grade', { columnId: 'c1' })
    await writer.add('grade', { columnId: 'c1' })
    await writer.add('grade', { columnId: 'c1' }) // здесь буфер оценок переполнился

    assert.deepEqual(
      calls.map((c) => c.model),
      ['gradeColumn', 'grade'],
      'колонки обязаны уйти в БД раньше оценок, иначе внешний ключ не сойдётся',
    )
  })

  it('flush дописывает буферы в порядке первого обращения к модели', async () => {
    const { client, calls } = mockPrisma(['post', 'comment', 'reaction'])
    const writer = createWriter(client, { chunkSize: 1000 })
    await writer.add('post', {})
    await writer.add('comment', {})
    await writer.add('reaction', {})
    await writer.flush()
    assert.deepEqual(
      calls.map((c) => c.model),
      ['post', 'comment', 'reaction'],
    )
  })

  it('пустой буфер не порождает запроса', async () => {
    const { client, calls } = mockPrisma(['post'])
    const writer = createWriter(client, {})
    await writer.flush()
    assert.equal(calls.length, 0)
  })

  it('опечатку в имени модели ловит сразу, а не на вставке', async () => {
    const { client } = mockPrisma(['post'])
    const writer = createWriter(client, {})
    await assert.rejects(() => writer.add('psot', {}), /не найдена в Prisma Client/)
  })

  it('к ошибке вставки добавляет модель и размер пачки', async () => {
    const client = {
      grade: {
        createMany: async () => {
          throw new Error('Foreign key constraint violated')
        },
      },
    }
    const writer = createWriter(client, { chunkSize: 2 })
    await writer.add('grade', {})
    await assert.rejects(() => writer.add('grade', {}), /createMany\(grade\) на 2 строк/)
  })
})
