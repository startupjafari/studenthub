import { describe, expect, it } from 'vitest'
import { canDeleteChat } from './chat-kind'

describe('canDeleteChat', () => {
  it('личный чат и пользовательская группа удаляются', () => {
    expect(canDeleteChat('PRIVATE')).toBe(true)
    expect(canDeleteChat('GROUP')).toBe(true)
  })

  it.each(['GROUP_OFFICIAL', 'SUBJECT', 'FACULTY', 'DEAN', 'SUPPORT', 'SAVED'] as const)(
    '%s — без пункта «Удалить»: официальный вернётся сам, «Сохранённые» потеряли бы заметки',
    (type) => {
      expect(canDeleteChat(type)).toBe(false)
    },
  )
})
