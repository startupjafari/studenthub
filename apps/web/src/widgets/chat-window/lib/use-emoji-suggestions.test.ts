import { describe, expect, it } from 'vitest'
import { matchEmojiQuery } from './use-emoji-suggestions'

describe('matchEmojiQuery — что перед курсором просит подсказку эмодзи', () => {
  it(':запрос от двух знаков в начале строки или после пробела', () => {
    expect(matchEmojiQuery(':ого')).toEqual({
      mode: 'colon',
      query: 'ого',
      closed: false,
      replaceLength: 4,
    })
    expect(matchEmojiQuery('ну и :fire')).toMatchObject({ mode: 'colon', query: 'fire' })
    expect(matchEmojiQuery(':о')).toBeNull()
  })

  it('закрывающее двоеточие — вставка без выбора, заменяется вместе с ним', () => {
    expect(matchEmojiQuery('и :огонь:')).toEqual({
      mode: 'colon',
      query: 'огонь',
      closed: true,
      replaceLength: 7,
    })
  })

  it('время и ссылки не считаются запросом', () => {
    expect(matchEmojiQuery('в 10:30')).toBeNull()
    expect(matchEmojiQuery('https://example.com')).toBeNull()
    expect(matchEmojiQuery('почта@mail')).toBeNull()
  })

  it('слово под курсором — от двух букв, заменяется само слово', () => {
    expect(matchEmojiQuery('мой кот')).toEqual({ mode: 'word', query: 'кот', replaceLength: 3 })
    expect(matchEmojiQuery('«огонь')).toMatchObject({ mode: 'word', query: 'огонь' })
    expect(matchEmojiQuery('кот ')).toBeNull()
    expect(matchEmojiQuery('к')).toBeNull()
    expect(matchEmojiQuery('кот2')).toBeNull()
  })
})
