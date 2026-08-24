import { Role, ROLE_HIERARCHY } from '@studenthub/shared-types'
import { describe, expect, it } from 'vitest'
import { quickActionsFor } from './quick-actions'

// Палитра открывается на быстрых действиях. Пустой список означает экран
// «введите запрос», на котором нечего выбрать — именно так она и выглядела для
// платформенных ролей и модератора вуза, потому что их просто забыли завести.
describe('quickActionsFor', () => {
  it('у каждой роли есть быстрые действия', () => {
    for (const role of ROLE_HIERARCHY) {
      expect(quickActionsFor(role), role).not.toHaveLength(0)
    }
  })

  it('«Документы» есть у всех ролей — раздел общий', () => {
    for (const role of ROLE_HIERARCHY) {
      expect(
        quickActionsFor(role).map((a) => a.navKey),
        role,
      ).toContain('documents')
    }
  })

  it('без роли действий нет', () => {
    expect(quickActionsFor(null)).toEqual([])
  })

  it('маршруты абсолютные, ключи внутри роли не повторяются', () => {
    for (const role of ROLE_HIERARCHY) {
      const actions = quickActionsFor(role)
      for (const action of actions) expect(action.href.startsWith('/'), action.href).toBe(true)
      // Дубль ключа дал бы две одинаковые подписи в списке.
      const keys = actions.map((a) => a.navKey)
      expect(new Set(keys).size, role).toBe(keys.length)
    }
  })

  it('администратор платформы попадает в свои разделы, а не в студенческие', () => {
    const hrefs = quickActionsFor(Role.PLATFORM_ADMIN).map((a) => a.href)
    expect(hrefs).toContain('/platform-admin/universities')
    expect(hrefs).toContain('/platform-admin/complaints')
    expect(hrefs.some((h) => h.startsWith('/teacher') || h.startsWith('/dean'))).toBe(false)
  })
})
