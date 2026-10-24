import { parseCorsOrigins, pickWebBase } from './web-base'

describe('parseCorsOrigins', () => {
  it('срезает пробелы вокруг origin: «a, b» — два рабочих origin', () => {
    expect(parseCorsOrigins('https://a.app, https://b.app')).toEqual([
      'https://a.app',
      'https://b.app',
    ])
  })

  it('пустые элементы (хвостовая запятая) отбрасываются', () => {
    expect(parseCorsOrigins('https://a.app,')).toEqual(['https://a.app'])
  })
})

describe('pickWebBase', () => {
  it('берёт первый origin без пробелов', () => {
    expect(pickWebBase(' https://a.app , https://b.app')).toBe('https://a.app')
  })
})
