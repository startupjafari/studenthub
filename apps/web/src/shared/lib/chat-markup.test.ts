import { describe, expect, it } from 'vitest'
import { replaceChatMarks, spoilerPlaceholder } from './chat-markup'
import { plainPreview } from './plain-text'

// Маркеры чата сверх CommonMark (PROJECT.md §3.6): подчёркнутый ++…++ и спойлер ||…||.
const show = (text: string) =>
  replaceChatMarks(text, (kind, inner) => (kind === 'spoiler' ? `[S:${inner}]` : `[U:${inner}]`))

describe('replaceChatMarks — пары маркеров', () => {
  it('подчёркнутый и спойлер', () => {
    expect(show('a ++b++ c')).toBe('a [U:b] c')
    expect(show('a ||b c|| d')).toBe('a [S:b c] d')
  })

  it('разметка внутри и вложение разных маркеров', () => {
    expect(show('||**ж** ++п++||')).toBe('[S:**ж** [U:п]]')
  })

  it('у края строки и у знаков препинания', () => {
    expect(show('||ответ||')).toBe('[S:ответ]')
    expect(show('(||ответ||).')).toBe('([S:ответ]).')
  })

  it('код и выражения остаются текстом', () => {
    for (const text of ['i++; j++', 'C++ и C++', 'a || b || c', 'a||b||c', 'x ++ y ++ z']) {
      expect(show(text)).toBe(text)
    }
  })

  it('серии из трёх знаков и пустая пара — текст', () => {
    expect(show('|||a|||')).toBe('|||a|||')
    expect(show('++++')).toBe('++++')
  })

  it('непарный маркер — текст', () => {
    expect(show('||без конца')).toBe('||без конца')
  })

  it('экранированный маркер — текст', () => {
    expect(show('\\||a||')).toBe('\\||a||')
    expect(show('\\|\\|a\\|\\|')).toBe('\\|\\|a\\|\\|')
  })

  it('внутри строчного кода не ищется', () => {
    expect(show('`||a||` и ||b||')).toBe('`||a||` и [S:b]')
    expect(show('||a `b||` c||')).toBe('[S:a `b||` c]')
  })

  it('пара не переходит через пустую строку', () => {
    expect(show('||a\n\nb||')).toBe('||a\n\nb||')
    expect(show('||a\nb||')).toBe('[S:a\nb]')
  })
})

describe('plainPreview — маркеры чата', () => {
  it('подчёркнутый — текстом, спойлер — знаками Брайля той же длины', () => {
    expect(plainPreview('++важно++ ответ: ||42||')).toBe('важно ответ: ⠿⠿')
  })

  it('текст спойлера в превью не попадает, разметка внутри не считается', () => {
    const preview = plainPreview('||**секрет**||')
    expect(preview).toBe('⠿⠿⠿⠿⠿⠿')
    expect(preview).not.toContain('секрет')
  })

  it('длинный спойлер — не больше 12 знаков', () => {
    expect(spoilerPlaceholder('x'.repeat(40))).toBe('⠿'.repeat(12))
  })

  it('экранированный маркер — знаком', () => {
    expect(plainPreview('\\|\\|a\\|\\|')).toBe('||a||')
  })

  it('у постов маркеров нет — текст как есть', () => {
    expect(plainPreview('||a||', { chatMarkup: false })).toBe('||a||')
  })

  it('прежняя разметка снимается как раньше', () => {
    expect(plainPreview('**срочно** по `ТЗ` [тут](https://x.kz)')).toBe('срочно по ТЗ тут')
  })
})
