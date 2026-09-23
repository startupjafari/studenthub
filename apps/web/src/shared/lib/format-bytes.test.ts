import { describe, expect, it } from 'vitest'
import { formatBytes, formatBytesProgress, toByteSize } from './format-bytes'

// Подписи единиц в тестах русские — ровно то, что подставит i18n на основной локали.
const RU = { b: 'Б', kb: 'КБ', mb: 'МБ', gb: 'ГБ' } as const
const unit = (u: keyof typeof RU): string => RU[u]

describe('toByteSize', () => {
  it('подбирает единицу по величине', () => {
    expect(toByteSize(512)).toEqual({ value: 512, unit: 'b' })
    expect(toByteSize(1024)).toEqual({ value: 1, unit: 'kb' })
    expect(toByteSize(1024 * 1024)).toEqual({ value: 1, unit: 'mb' })
    expect(toByteSize(1024 ** 3)).toEqual({ value: 1, unit: 'gb' })
  })

  it('округляет килобайты целыми, мегабайты — до десятых', () => {
    expect(toByteSize(136 * 1024)).toEqual({ value: 136, unit: 'kb' })
    expect(toByteSize(Math.round(4.44 * 1024 * 1024))).toEqual({ value: 4.4, unit: 'mb' })
  })

  it('не падает на мусорных значениях', () => {
    expect(toByteSize(-5)).toEqual({ value: 0, unit: 'b' })
    expect(toByteSize(Number.NaN)).toEqual({ value: 0, unit: 'b' })
  })
})

describe('formatBytes', () => {
  it('склеивает число с переведённой единицей', () => {
    expect(formatBytes(4.4 * 1024 * 1024, unit)).toBe('4.4 МБ')
    expect(formatBytes(1024, unit)).toBe('1 КБ')
  })
})

describe('formatBytesProgress', () => {
  it('показывает обе величины в единице полного размера', () => {
    const total = 40.1 * 1024 * 1024
    expect(formatBytesProgress(11.5 * 1024 * 1024, total, unit)).toBe('11.5 / 40.1 МБ')
  })

  it('держит единицу по итогу, а не по уже загруженному', () => {
    // На первых килобайтах сорокамегабайтного файла строка обязана остаться в мегабайтах,
    // иначе «КБ из МБ» и прыгающие единицы на каждом обновлении прогресса.
    expect(formatBytesProgress(2048, 40 * 1024 * 1024, unit)).toBe('0 / 40 МБ')
  })

  it('не выходит за пределы полного размера', () => {
    const total = 10 * 1024 * 1024
    expect(formatBytesProgress(total * 2, total, unit)).toBe('10 / 10 МБ')
    expect(formatBytesProgress(-1, total, unit)).toBe('0 / 10 МБ')
  })
})
