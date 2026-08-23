import { describe, expect, it } from 'vitest'

import { IDENTITY_COLORS, identityColor, identityInitials } from './identity-color'

describe('identityColor', () => {
  it('один и тот же id всегда даёт один и тот же цвет', () => {
    // Раньше палитра лежала копиями в четырёх файлах чатов: цвет человека мог
    // отличаться между списком, карточкой и диалогом пересылки.
    const id = 'a3f1c0de-0000-4000-8000-000000000001'
    expect(identityColor(id)).toBe(identityColor(id))
  })

  it('цвет всегда из палитры', () => {
    for (const id of ['', 'x', 'user-1', 'user-2', '汉字', '9f'.repeat(20)]) {
      expect(IDENTITY_COLORS).toContain(identityColor(id))
    }
  })

  it('разные id расходятся по палитре, а не липнут к одному цвету', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => identityColor(`user-${i}`)))
    expect(used.size).toBe(IDENTITY_COLORS.length)
  })
})

describe('identityInitials', () => {
  it('берёт первые буквы двух первых слов', () => {
    expect(identityInitials('Айгерим Касымова')).toBe('АК')
    expect(identityInitials('  Пётр   Сергеевич  Иванов ')).toBe('ПС')
  })

  it('одно слово — одна буква', () => {
    expect(identityInitials('Группа')).toBe('Г')
  })

  it('пустое имя не даёт пустой кружок', () => {
    expect(identityInitials('')).toBe('#')
    expect(identityInitials('   ')).toBe('#')
  })
})
