import { describe, expect, it } from 'vitest'
import {
  planInteractive,
  pollPercents,
  pollShape,
  pollVisibleCount,
  safeStoryLink,
} from './interactive-layout'

// Кадр 9:16 на десктопе (30rem) и низкий кадр маленького окна.
const DESKTOP = { frameWidth: 480, frameHeight: 853 }
const LOW = { frameWidth: 270, frameHeight: 480 }

describe('раскладка вариантов опроса', () => {
  it('два коротких — рядом, три-четыре коротких — сеткой, длинный — столбиком', () => {
    expect(pollShape(['Да', 'Нет'])).toBe('row')
    expect(pollShape(['Утро', 'День', 'Вечер'])).toBe('grid')
    expect(pollShape(['А', 'Б', 'В', 'Г'])).toBe('grid')
    expect(pollShape(['Да', 'Только если будет онлайн-трансляция'])).toBe('list')
    expect(pollShape(Array.from({ length: 10 }, (_, i) => `#${i}`))).toBe('list')
  })
})

describe('сколько вариантов влезает в компактный опрос', () => {
  it('на обычном кадре помещаются все четыре', () => {
    const options = ['Очень длинный вариант номер один', 'Второй', 'Третий', 'Четвёртый']
    expect(pollVisibleCount({ ...DESKTOP, options, question: 'Как вам?' })).toBe(4)
  })

  it('десять вариантов не помещаются — часть и кнопка «Все варианты», в пределах 30%', () => {
    const options = Array.from({ length: 10 }, (_, i) => `Вариант ответа номер ${i + 1}`)
    const visible = pollVisibleCount({ ...DESKTOP, options, question: 'Вопрос' })
    expect(visible).toBeGreaterThan(0)
    expect(visible).toBeLessThan(10)
    // Карточка: поля 24 + вопрос 20 + зазор 8 + варианты + кнопка 36 — не больше 30% кадра.
    const height = 24 + 20 + 8 + visible * 40 + (visible - 1) * 6 + 6 + 36
    expect(height).toBeLessThanOrEqual(DESKTOP.frameHeight * 0.3)
  })

  it('на низком кадре с длинным вопросом видно меньше вариантов', () => {
    const options = ['Первый длинный вариант', 'Второй длинный вариант', 'Третий длинный вариант']
    const question = 'Очень длинный вопрос, который точно переносится на вторую строку карточки'
    const low = pollVisibleCount({ ...LOW, options, question })
    const desktop = pollVisibleCount({ ...DESKTOP, options, question })
    expect(low).toBeLessThan(desktop)
  })

  it('сетку не обрывает посередине ряда', () => {
    const options = ['А', 'Б', 'В', 'Г']
    const visible = pollVisibleCount({ frameWidth: 270, frameHeight: 330, options, question: 'Q' })
    expect(visible % 2).toBe(0)
  })
})

describe('режим слоя', () => {
  it('один вид — стопкой; одна отметка не даёт «Упомянуты»', () => {
    expect(
      planInteractive({ hasPoll: true, hasLink: false, mentionCount: 1, frameHeight: 853 }),
    ).toEqual({ kinds: ['poll'], mode: 'stack' })
    expect(
      planInteractive({ hasPoll: false, hasLink: true, mentionCount: 0, frameHeight: 853 }),
    ).toEqual({ kinds: ['link'], mode: 'stack' })
  })

  it('опрос и ссылка: стопкой на обычном кадре, вкладками на низком', () => {
    const base = { hasPoll: true, hasLink: true, mentionCount: 0 }
    expect(planInteractive({ ...base, frameHeight: 853 }).mode).toBe('stack')
    expect(planInteractive({ ...base, frameHeight: 480 }).mode).toBe('tabs')
  })

  it('опрос, ссылка и люди — всегда вкладками, опрос первым', () => {
    expect(
      planInteractive({ hasPoll: true, hasLink: true, mentionCount: 3, frameHeight: 1200 }),
    ).toEqual({ kinds: ['poll', 'link', 'people'], mode: 'tabs' })
  })

  it('ссылка и люди без опроса — стопкой даже на низком кадре: оба стикера компактные', () => {
    expect(
      planInteractive({ hasPoll: false, hasLink: true, mentionCount: 2, frameHeight: 480 }).mode,
    ).toBe('stack')
  })
})

describe('проценты голосов', () => {
  it('в сумме ровно 100', () => {
    expect(pollPercents([1, 1, 1])).toEqual([34, 33, 33])
    expect(pollPercents([1, 2])).toEqual([33, 67])
    expect(pollPercents([3, 3, 1, 0]).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('без голосов — нули', () => {
    expect(pollPercents([0, 0])).toEqual([0, 0])
  })
})

describe('безопасная ссылка', () => {
  it('только http и https', () => {
    expect(safeStoryLink('https://kremlin.ru/events')?.hostname).toBe('kremlin.ru')
    expect(safeStoryLink('javascript:alert(1)')).toBeNull()
    expect(safeStoryLink('not a url')).toBeNull()
    expect(safeStoryLink(null)).toBeNull()
  })
})
