import { describe, expect, it } from 'vitest'
import { applyMention, mentionQuery } from './mention-suggest'

describe('mentionQuery', () => {
  it('ловит незакрытое упоминание перед курсором', () => {
    expect(mentionQuery('привет @iva', 11)).toBe('iva')
    expect(mentionQuery('@iva', 4)).toBe('iva')
  })

  it('пустое упоминание сразу после @ тоже считается началом', () => {
    expect(mentionQuery('привет @', 8)).toBe('')
  })

  it('почту за упоминание не принимает', () => {
    expect(mentionQuery('mail@example', 12)).toBeNull()
  })

  it('после пробела упоминание закрыто', () => {
    expect(mentionQuery('@ivanov привет', 14)).toBeNull()
  })

  it('смотрит только до курсора, а не на весь текст', () => {
    // Курсор в начале — набранного упоминания перед ним нет.
    expect(mentionQuery('привет @iva', 3)).toBeNull()
  })
})

describe('applyMention', () => {
  it('подставляет логин и ставит курсор после пробела', () => {
    const r = applyMention('привет @iva', 11, 'ivanov')
    expect(r.text).toBe('привет @ivanov ')
    expect(r.caret).toBe(r.text.length)
  })

  it('сохраняет хвост после курсора', () => {
    const r = applyMention('@iva, привет', 4, 'ivanov')
    expect(r.text).toBe('@ivanov , привет')
    expect(r.text.slice(r.caret)).toBe(', привет')
  })
})
