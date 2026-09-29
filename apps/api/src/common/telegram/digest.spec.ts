import { digestText, humanAge } from './digest'

const empty = { count: 0, oldestAt: null, created: 0, closed: 0 }

describe('humanAge', () => {
  it('минуты, часы и сутки', () => {
    expect(humanAge(20 * 60_000)).toBe('20 мин')
    expect(humanAge(5 * 3_600_000)).toBe('5 ч')
    expect(humanAge(70 * 3_600_000)).toBe('2 сут')
  })
})

describe('digestText', () => {
  const now = new Date('2026-09-29T12:00:00Z')

  it('показывает и очередь, и движение за сутки', () => {
    const text = digestText({
      complaints: { ...empty, count: 0, created: 4, closed: 4 },
      tickets: { ...empty, count: 1, created: 2, closed: 1 },
      dutyName: 'Иван Иванов',
      now,
    })
    expect(text).toContain('Жалобы: в очереди 0, пришло 4, разобрано 4')
    expect(text).toContain('Обращения: открыто 1, пришло 2, закрыто 1')
    expect(text).toContain('Дежурит: Иван Иванов')
  })

  it('на пустой очереди не пишет про возраст', () => {
    const text = digestText({ complaints: empty, tickets: empty, dutyName: null, now })
    expect(text).not.toContain('Старейшее')
    expect(text).toContain('Дежурного нет')
  })

  it('возраст берёт у самого старого из двух очередей', () => {
    const text = digestText({
      complaints: { ...empty, count: 1, oldestAt: new Date(now.getTime() - 5 * 3_600_000) },
      tickets: { ...empty, count: 1, oldestAt: new Date(now.getTime() - 30 * 60_000) },
      dutyName: null,
      now,
    })
    expect(text).toContain('Старейшее ждёт: 5 ч')
  })
})
