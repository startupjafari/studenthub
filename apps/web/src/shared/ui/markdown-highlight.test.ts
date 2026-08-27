import { describe, expect, it } from 'vitest'
import { highlightMarkdown } from './markdown'

// Подсветка рисуется ПОД прозрачным текстом поля ввода. Если она потеряет или добавит
// хоть один символ, слои разъедутся — поэтому главный инвариант проверяем на каждом
// примере: склейка кусков обязана быть равна исходной строке.
function joined(source: string): string {
  return highlightMarkdown(source)
    .map((line) => line.map((t) => t.text).join(''))
    .join('\n')
}

describe('highlightMarkdown', () => {
  const samples = [
    'обычный текст',
    '**жирный** и *курсив*',
    '`код` и ~~зачёркнутый~~',
    '- пункт списка',
    '1. нумерованный',
    '> цитата',
    '[ссылка](https://example.com) в тексте',
    'смешанное **жирное `и код`** подряд',
    '',
    'первая\nвторая\n\nчетвёртая',
  ]

  it.each(samples)('сохраняет каждый символ: %j', (source) => {
    expect(joined(source)).toBe(source)
  })

  it('маркеры помечены, содержимое оформлено', () => {
    const [line] = highlightMarkdown('**жирный**')
    expect(line?.filter((t) => t.marker).map((t) => t.text)).toEqual(['**', '**'])
    expect(line?.find((t) => !t.marker)?.text).toBe('жирный')
    expect(line?.find((t) => !t.marker)?.className).toContain('font-semibold')
  })

  it('префикс списка — маркер, а не часть текста', () => {
    const [line] = highlightMarkdown('- пункт')
    expect(line?.[0]).toMatchObject({ text: '- ', marker: true })
  })

  it('в ссылке адрес приглушён, подпись оформлена', () => {
    const [line] = highlightMarkdown('[тут](https://a.b)')
    expect(line?.find((t) => t.text === 'тут')?.className).toContain('underline')
    expect(line?.some((t) => t.marker && t.text.includes('https://a.b'))).toBe(true)
  })
})
