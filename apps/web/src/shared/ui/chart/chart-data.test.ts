import { describe, expect, it } from 'vitest'
import {
  categoryAxisWidth,
  seriesOpacity,
  toRows,
  topVisibleKey,
  type ChartSeries,
} from './chart-data'

function series(over: Partial<ChartSeries> & { key: string }): ChartSeries {
  return { label: over.key, color: '#000000', values: [], ...over }
}

describe('toRows', () => {
  it('раскладывает серии в строки по корзинам', () => {
    const rows = toRows(
      ['01 авг', '02 авг'],
      [series({ key: 'students', values: [3, 5] }), series({ key: 'staff', values: [1, 0] })],
    )
    expect(rows).toEqual([
      { label: '01 авг', students: 3, staff: 1 },
      { label: '02 авг', students: 5, staff: 0 },
    ])
  })

  it('добирает нулями серию короче подписей', () => {
    // Ряды с сервера уже досыпаны нулями, но панель успевает отрисоваться на
    // частичных данных — дыра в строке уронила бы шкалу, а не показала провал.
    const rows = toRows(['пн', 'вт', 'ср'], [series({ key: 'dau', values: [4] })])
    expect(rows.map((r) => r.dau)).toEqual([4, 0, 0])
  })

  it('явный null остаётся пропуском, а не нулём', () => {
    // Неделя без отметок — «нечего считать»: линия рвётся, а не падает в 0 %.
    const rows = toRows(['пн', 'вт', 'ср'], [series({ key: 'rate', values: [null, 80, null] })])
    expect(rows.map((r) => r.rate)).toEqual([null, 80, null])
  })

  it('скрытые серии остаются в строках', () => {
    // Их прячет `hide` на самой линии: когда серию включают обратно, данные уже
    // есть и повторной анимации входа не происходит.
    const rows = toRows(['пн'], [series({ key: 'wau', values: [7], hidden: true })])
    expect(rows[0]?.wau).toBe(7)
  })
})

describe('topVisibleKey', () => {
  const stack = [series({ key: 'USED' }), series({ key: 'PENDING' }), series({ key: 'EXPIRED' })]

  it('верх стека — последняя видимая серия', () => {
    expect(topVisibleKey(stack)).toBe('EXPIRED')
  })

  it('при выключении верхней скругление переходит к следующей', () => {
    const withHidden = stack.map((s) => (s.key === 'EXPIRED' ? { ...s, hidden: true } : s))
    expect(topVisibleKey(withHidden)).toBe('PENDING')
  })

  it('без видимых серий верха нет', () => {
    expect(topVisibleKey(stack.map((s) => ({ ...s, hidden: true })))).toBeNull()
  })
})

describe('seriesOpacity', () => {
  it('без наведения все серии в полную краску', () => {
    expect(seriesOpacity('dau', null)).toBe(1)
  })

  it('наведённая остаётся, остальные уходят в фон', () => {
    expect(seriesOpacity('dau', 'dau')).toBe(1)
    expect(seriesOpacity('wau', 'dau')).toBeLessThan(1)
  })
})

describe('categoryAxisWidth', () => {
  it('растёт вместе с самой длинной подписью', () => {
    expect(categoryAxisWidth(['Пн'])).toBeLessThan(
      categoryAxisWidth(['Казахский национальный университет']),
    )
  })

  it('ограничена с обеих сторон — полосы не съедает и подписи не режет', () => {
    expect(categoryAxisWidth([])).toBe(64)
    expect(categoryAxisWidth(['я'.repeat(200)])).toBe(220)
  })
})
