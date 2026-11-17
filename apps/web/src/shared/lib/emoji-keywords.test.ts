import { describe, expect, it } from 'vitest'
import {
  buildEmojiKeywordIndex,
  dictLocalesFor,
  loadEmojiKeywords,
  type RawEmoji,
} from './emoji-keywords'

const FIXTURE: RawEmoji[] = [
  { unicode: '❤️‍🔥', label: 'сердце в огне', tags: ['огонь', 'любовь'], group: 1, order: 10 },
  { unicode: '🔥', label: 'огонь', tags: ['пламя'], group: 5, order: 50 },
  { unicode: '😂', label: 'смеется до слез', tags: ['смешно', 'ржака'], group: 0, order: 8 },
  { unicode: '🏻', label: 'светлый тон кожи', tags: [], group: 2, order: 1 },
  { unicode: '🇦', label: 'региональный показатель A' },
]

describe('buildEmojiKeywordIndex', () => {
  const index = buildEmojiKeywordIndex([FIXTURE])

  it('слово под курсором: название целиком раньше тега', () => {
    expect(index.exact('огонь', 5)).toEqual(['🔥', '❤️‍🔥'])
    expect(index.exact('Огонь', 5)).toEqual(['🔥', '❤️‍🔥'])
  })

  it('слово под курсором — только точное совпадение', () => {
    expect(index.exact('ого', 5)).toEqual([])
    expect(index.exact('смеется', 5)).toEqual([])
  })

  it(':запрос ищет по началу тегов и слов названия', () => {
    expect(index.search('сме', 5)).toEqual(['😂'])
    expect(index.search('слез', 5)).toEqual(['😂'])
    expect(index.search('пла', 5)).toEqual(['🔥'])
  })

  it('ё и е не различаются', () => {
    expect(index.search('смеёт', 5)).toEqual(['😂'])
  })

  it('компоненты и региональные буквы не предлагаются', () => {
    expect(index.search('светлый', 5)).toEqual([])
    expect(index.search('региональный', 5)).toEqual([])
  })

  it('потолок выдачи соблюдается', () => {
    expect(index.search('о', 1)).toHaveLength(1)
  })
})

describe('словари по языку интерфейса', () => {
  it('kk — русский и английский (казахского в CLDR-наборе нет)', () => {
    expect(dictLocalesFor('kk')).toEqual(['ru', 'en'])
    expect(dictLocalesFor('ru')).toEqual(['ru', 'en'])
    expect(dictLocalesFor('en')).toEqual(['en'])
  })

  it('настоящие словари: русские и английские слова находят смайл', async () => {
    const index = await loadEmojiKeywords('kk')
    expect(index.exact('кот', 20)).toContain('🐱')
    expect(index.exact('cat', 20)).toContain('🐱')
    expect(index.exact('огонь', 3)[0]).toBe('🔥')
    expect(index.search('ржак', 5)).toContain('😂')
  })
})
