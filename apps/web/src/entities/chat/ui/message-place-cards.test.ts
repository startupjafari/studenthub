import { describe, expect, it } from 'vitest'
import { contactInitials } from './message-place-cards'

describe('contactInitials', () => {
  it('первые буквы двух слов имени', () => {
    expect(contactInitials('Сулейменов Асылбек')).toBe('СА')
    expect(contactInitials('  анна  ')).toBe('А')
    expect(contactInitials('Иван Петрович Сидоров')).toBe('ИП')
    expect(contactInitials('')).toBe('')
  })
})
