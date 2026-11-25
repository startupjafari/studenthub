import { describe, expect, it } from 'vitest'
import { articleStats } from './article-stats'

describe('статистика редактора статьи', () => {
  it('пустой текст — ноль слов и ноль минут, а не «1 минута»', () => {
    expect(articleStats('   \n ')).toEqual({ words: 0, chars: 5, minutes: 0 })
  })

  it('время чтения — как у сервера: 200 слов в минуту, вверх до целой минуты', () => {
    expect(articleStats('слово').minutes).toBe(1)
    expect(articleStats(Array.from({ length: 200 }, () => 'w').join(' ')).minutes).toBe(1)
    expect(articleStats(Array.from({ length: 201 }, () => 'w').join(' ')).minutes).toBe(2)
  })
})
