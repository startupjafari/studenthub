import { describe, expect, it } from 'vitest'
import {
  LIKE_EMOJI,
  hasMyReaction,
  reactionSummaryOf,
  reactionTotal,
  withMyReaction,
} from './reactions'

describe('reactionSummaryOf', () => {
  it('готовая сводка из ответа API берётся как есть', () => {
    const summary = [{ emoji: LIKE_EMOJI, count: 1200, mine: true }]
    expect(reactionSummaryOf({ reactionSummary: summary, reactions: [] }, 'me')).toBe(summary)
  })

  it('ответ старого API: построчные реакции сворачиваются по эмодзи, своя — по userId', () => {
    const summary = reactionSummaryOf(
      {
        reactions: [
          { emoji: LIKE_EMOJI, userId: 'u1' },
          { emoji: LIKE_EMOJI, userId: 'me' },
          { emoji: '🔥', userId: 'u2' },
        ],
      },
      'me',
    )
    expect(summary).toEqual([
      { emoji: LIKE_EMOJI, count: 2, mine: true },
      { emoji: '🔥', count: 1, mine: false },
    ])
  })

  it('ни сводки, ни строк — пусто', () => {
    expect(reactionSummaryOf({}, 'me')).toEqual([])
  })
})

describe('withMyReaction', () => {
  const base = [
    { emoji: LIKE_EMOJI, count: 3, mine: false },
    { emoji: '👍', count: 2, mine: true },
  ]

  it('лайк: +1 к счётчику и своя реакция', () => {
    const next = withMyReaction(base, LIKE_EMOJI, true)
    expect(next[0]).toEqual({ emoji: LIKE_EMOJI, count: 4, mine: true })
    expect(reactionTotal(next)).toBe(6)
    expect(hasMyReaction(next, LIKE_EMOJI)).toBe(true)
  })

  it('первая реакция такого эмодзи добавляет строку сводки', () => {
    expect(withMyReaction([], LIKE_EMOJI, true)).toEqual([
      { emoji: LIKE_EMOJI, count: 1, mine: true },
    ])
  })

  it('снятие своей: −1 к счётчику; последней — строка уходит, а не остаётся ноль', () => {
    expect(withMyReaction(base, '👍', false)).toEqual([
      base[0],
      { emoji: '👍', count: 1, mine: false },
    ])
    expect(withMyReaction([{ emoji: '👍', count: 1, mine: true }], '👍', false)).toEqual([])
  })

  it('повтор того же состояния счётчик не меняет', () => {
    expect(withMyReaction(base, '👍', true)).toEqual(base)
    expect(withMyReaction(base, LIKE_EMOJI, false)).toEqual(base)
  })
})
