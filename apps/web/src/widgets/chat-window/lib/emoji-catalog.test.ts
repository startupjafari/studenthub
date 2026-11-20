import { describe, expect, it } from 'vitest'
import {
  RECENT_LIMIT,
  buildSections,
  detectMaxVersion,
  pushRecent,
  searchEmojis,
  type CatalogEmoji,
} from './emoji-catalog'

const e = (emoji: string, category: number, label: string, extra: Partial<CatalogEmoji> = {}) => ({
  emoji,
  category,
  label,
  version: 1,
  tags: [],
  ...extra,
})

const CATALOG: CatalogEmoji[] = [
  e('😀', 0, 'улыбка', { tags: ['радость'] }),
  e('🫠', 0, 'тающее лицо', { version: 14 }),
  e('👋', 1, 'машет рукой'),
  e('🏻', 2, 'светлый тон кожи'),
  e('🐱', 3, 'кот', { tags: ['кошка'] }),
  e('🐄', 3, 'корова', { tags: ['скот'] }),
  e('🍕', 4, 'пицца'),
  e('🚗', 5, 'машина'),
  e('⚽', 6, 'футбол'),
  e('💡', 7, 'лампочка'),
  e('❤️', 8, 'сердце'),
  e('🇰🇿', 9, 'флаг: Казахстан', { countryFlag: true }),
]
const GROUPS = [
  { index: 0, label: 'Смайлики и эмоции' },
  { index: 1, label: 'Люди и тело' },
  { index: 3, label: 'Животные и природа' },
  { index: 9, label: 'Флаги' },
]
const ALL = { maxVersion: 16, flags: true }

describe('каталог эмодзи панели ввода', () => {
  it('разделы идут в порядке Telegram, смайлы и люди — одним разделом', () => {
    const sections = buildSections(CATALOG, GROUPS, ['👍'], ALL)
    expect(sections.map((s) => s.id)).toEqual([
      'recent',
      'people',
      'nature',
      'foods',
      'activity',
      'places',
      'objects',
      'symbols',
      'flags',
    ])
    expect(sections[1]?.emojis).toEqual(['😀', '🫠', '👋'])
    expect(sections[0]?.emojis).toEqual(['👍'])
    // У одиночных групп — название из данных, у слитой «смайлы и люди» — своё (из i18n).
    expect(sections.find((s) => s.id === 'nature')?.groupLabel).toBe('Животные и природа')
    expect(sections.find((s) => s.id === 'people')?.groupLabel).toBeUndefined()
  })

  it('тона кожи в сетку не попадают', () => {
    const all = buildSections(CATALOG, GROUPS, [], ALL).flatMap((s) => s.emojis)
    expect(all).not.toContain('🏻')
  })

  it('эмодзи новее шрифта системы и флаги без поддержки прячутся', () => {
    const sections = buildSections(CATALOG, GROUPS, [], { maxVersion: 13, flags: false })
    expect(sections.flatMap((s) => s.emojis)).not.toContain('🫠')
    expect(sections.map((s) => s.id)).not.toContain('flags')
    // Пустые «Недавние» раздела не дают.
    expect(sections.map((s) => s.id)).not.toContain('recent')
  })

  it('поиск: сначала совпадения с начала слова, потом внутри', () => {
    expect(searchEmojis(CATALOG, 'кот', ALL)).toEqual(['🐱', '🐄'])
    expect(searchEmojis(CATALOG, 'кош', ALL)).toEqual(['🐱'])
    expect(searchEmojis(CATALOG, 'радость', ALL)).toEqual(['😀'])
    expect(searchEmojis(CATALOG, '   ', ALL)).toEqual([])
    expect(searchEmojis(CATALOG, 'тающее', { maxVersion: 13, flags: true })).toEqual([])
  })

  it('недавние: выбранный первым, без повторов, не длиннее лимита', () => {
    expect(pushRecent(['😀', '👍', '🔥'], '🔥')).toEqual(['🔥', '😀', '👍'])
    const long = Array.from({ length: RECENT_LIMIT }, (_, i) => String(i))
    const next = pushRecent(long, 'x')
    expect(next).toHaveLength(RECENT_LIMIT)
    expect(next[0]).toBe('x')
    expect(next).not.toContain(String(RECENT_LIMIT - 1))
  })

  it('потолок версии — первая версия, чей образец система рисует', () => {
    expect(detectMaxVersion(() => true)).toBe(16)
    expect(detectMaxVersion((x) => x === '🥲' || x === '🥱')).toBe(13)
    expect(detectMaxVersion(() => false)).toBe(5)
  })
})
