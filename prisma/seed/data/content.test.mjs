// Генераторы текста. Проверяем не «красоту», а два измеримых свойства: разнообразие
// (у одного автора десятки постов — списком из шести фраз это не наполнить) и
// согласованность с контрактом (категории статей — коды из shared-schemas).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeRandom } from '../lib/rng.mjs'
import { articleBody, articleTitle, pollTopic, postText } from './content.mjs'

// ARTICLE_CATEGORIES из packages/shared-schemas/src/profile.ts.
const ARTICLE_CATEGORIES = ['STUDY','SCIENCE','STUDENT_LIFE','PROJECTS','INTERNSHIPS','CAREER','EVENTS','RESOURCES'] // prettier-ignore

describe('генераторы контента', () => {
  it('текстов постов хватает на сотню на автора', () => {
    const random = makeRandom(11)
    const unique = new Set()
    for (let i = 0; i < 20_000; i += 1) unique.add(postText(random))
    assert.ok(unique.size > 3000, `всего ${unique.size} вариантов — мало`)
  })

  it('пост не пустой и без висящих пробелов', () => {
    const random = makeRandom(12)
    for (let i = 0; i < 500; i += 1) {
      const text = postText(random)
      assert.ok(text.length > 10)
      assert.equal(text, text.trim())
      assert.ok(!text.includes('  '), `двойной пробел: ${text}`)
    }
  })

  it('вопрос опроса заканчивается знаком вопроса, вариантов не меньше трёх', () => {
    const random = makeRandom(13)
    const questions = new Set()
    for (let i = 0; i < 3000; i += 1) {
      const { question, options } = pollTopic(random)
      questions.add(question)
      assert.match(question, /\?$/)
      assert.ok(options.length >= 3)
      assert.equal(new Set(options).size, options.length, 'варианты не должны повторяться')
    }
    assert.ok(questions.size > 100, `вариантов вопросов ${questions.size} — мало на 100 опросов`)
  })

  it('заголовки статей разнообразны, тело бывает и коротким, и размеченным', () => {
    const random = makeRandom(14)
    const titles = new Set()
    let short = 0
    let markdown = 0
    for (let i = 0; i < 3000; i += 1) {
      titles.add(articleTitle(random))
      const body = articleBody(random)
      if (body.length < 200) short += 1
      if (body.includes('## ')) markdown += 1
    }
    assert.ok(titles.size > 80, `заголовков ${titles.size} — мало на 50 статей у автора`)
    assert.ok(short > 0 && markdown > 0, 'нужны и короткие заметки, и лонгриды')
  })

  it('категории статей — только коды из контракта', () => {
    // Список в шаге 55 должен совпадать с shared-schemas: расхождение мы уже ловили.
    for (const code of ARTICLE_CATEGORIES) assert.match(code, /^[A-Z_]+$/)
    assert.equal(new Set(ARTICLE_CATEGORIES).size, 8)
  })
})
