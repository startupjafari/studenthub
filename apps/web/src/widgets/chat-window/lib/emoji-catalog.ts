// Каталог эмодзи панели ввода — разделы как в Telegram: «Недавние», затем восемь групп
// (смайлы и люди, животные, еда, спорт, транспорт, предметы, символы, флаги). Данные —
// emojibase через frimousse (уже стоит в проекте), здесь только раскладка и поиск.

/** Эмодзи в том виде, в каком его отдаёт emojibase (frimousse `EmojiData`). */
export interface CatalogEmoji {
  emoji: string
  /** Индекс группы emojibase (0 — смайлы, 1 — люди, 2 — тона кожи, 3 — животные…). */
  category: number
  label: string
  version: number
  tags: string[]
  countryFlag?: true
}

/** Раздел панели в порядке Telegram. */
export type EmojiSectionId =
  'recent' | 'people' | 'nature' | 'foods' | 'activity' | 'places' | 'objects' | 'symbols' | 'flags'

export const EMOJI_SECTION_ORDER: readonly EmojiSectionId[] = [
  'recent',
  'people',
  'nature',
  'foods',
  'activity',
  'places',
  'objects',
  'symbols',
  'flags',
]

/**
 * Группы emojibase → разделы Telegram. Telegram сводит «смайлы» и «людей» в один раздел;
 * группа 2 («компоненты»: тона кожи, причёски) в панели не показывается — как и у emojibase.
 * Порядок групп по индексам: 0 smileys, 1 people, 3 animals, 4 food, 5 travel, 6 activities,
 * 7 objects, 8 symbols, 9 flags (в Telegram «спорт» идёт перед «транспортом»).
 */
const SECTION_BY_GROUP: Record<number, Exclude<EmojiSectionId, 'recent'>> = {
  0: 'people',
  1: 'people',
  3: 'nature',
  4: 'foods',
  5: 'places',
  6: 'activity',
  7: 'objects',
  8: 'symbols',
  9: 'flags',
}

export interface EmojiSection {
  id: EmojiSectionId
  /** Название группы из данных emojibase (у «Недавних» и «Смайлов и людей» — своё, из i18n). */
  groupLabel?: string
  emojis: string[]
}

/**
 * Разложить каталог по разделам Telegram. `maxVersion` — старшая версия Unicode Emoji, которую
 * умеет нарисовать шрифт системы: более новые эмодзи вместо картинки дали бы пустой квадрат.
 * `flags` — рисует ли система флаги (Windows вместо флага пишет две буквы).
 */
export function buildSections(
  emojis: readonly CatalogEmoji[],
  groups: readonly { index: number; label: string }[],
  recent: readonly string[],
  support: { maxVersion: number; flags: boolean },
): EmojiSection[] {
  const byId = new Map<EmojiSectionId, EmojiSection>()
  for (const id of EMOJI_SECTION_ORDER) byId.set(id, { id, emojis: [] })
  for (const g of groups) {
    const id = SECTION_BY_GROUP[g.index]
    const section = id ? byId.get(id) : undefined
    // У слитого раздела название берётся из i18n, своё у группы — только у одиночных.
    if (section && id !== 'people') section.groupLabel = g.label
  }
  for (const e of emojis) {
    if (e.version > support.maxVersion) continue
    if (e.countryFlag && !support.flags) continue
    const id = SECTION_BY_GROUP[e.category]
    if (id) byId.get(id)?.emojis.push(e.emoji)
  }
  const recentSection = byId.get('recent')
  if (recentSection) recentSection.emojis = [...recent]
  return EMOJI_SECTION_ORDER.map((id) => byId.get(id)).filter(
    (s): s is EmojiSection => !!s && s.emojis.length > 0,
  )
}

/**
 * Поиск по названию и ключевым словам на языке интерфейса. Совпадение с начала слова
 * важнее совпадения в середине: на «кот» сначала коты, а не «бегемот».
 */
export function searchEmojis(
  emojis: readonly CatalogEmoji[],
  query: string,
  support: { maxVersion: number; flags: boolean },
  limit = 120,
): string[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return []
  const starts: string[] = []
  const contains: string[] = []
  for (const e of emojis) {
    if (e.version > support.maxVersion || (e.countryFlag && !support.flags)) continue
    if (e.category === 2) continue
    const words = [e.label, ...e.tags].map((w) => w.toLocaleLowerCase())
    if (words.some((w) => w.startsWith(q) || w.split(/\s+/).some((p) => p.startsWith(q)))) {
      starts.push(e.emoji)
    } else if (words.some((w) => w.includes(q))) contains.push(e.emoji)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}

/** Сколько эмодзи помнит раздел «Недавние»: три ряда по девять, как в Telegram. */
export const RECENT_LIMIT = 27

/**
 * Начальные «Недавние» — пока человек ничего не выбирал, раздел не пустует (в Telegram у
 * нового аккаунта он тоже заполнен самыми частыми).
 */
export const DEFAULT_RECENT: readonly string[] = [
  '👍',
  '😂',
  '❤️',
  '🔥',
  '😊',
  '🙏',
  '😭',
  '😍',
  '🎉',
  '😅',
  '🤔',
  '👏',
  '😁',
  '😉',
  '🥰',
  '😢',
  '😎',
  '👀',
]

/** Выбранный эмодзи встаёт первым, повтор убирается, хвост обрезается по лимиту. */
export function pushRecent(
  recent: readonly string[],
  emoji: string,
  limit = RECENT_LIMIT,
): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, limit)
}

/**
 * Пробные эмодзи по версиям Unicode Emoji — от новых к старым. Первая версия, чей образец
 * система рисует одной цветной картинкой, и есть потолок для панели.
 */
export const VERSION_PROBES: readonly { version: number; emoji: string }[] = [
  { version: 16, emoji: '🫩' },
  { version: 15.1, emoji: '🙂‍↔️' },
  { version: 15, emoji: '🫨' },
  { version: 14, emoji: '🫠' },
  { version: 13.1, emoji: '😶‍🌫️' },
  { version: 13, emoji: '🥲' },
  { version: 12.1, emoji: '🧑‍🦰' },
  { version: 12, emoji: '🥱' },
  { version: 11, emoji: '🥰' },
]

/** Самая новая поддерживаемая версия по проверке `renders(emoji)`. */
export function detectMaxVersion(renders: (emoji: string) => boolean): number {
  for (const probe of VERSION_PROBES) if (renders(probe.emoji)) return probe.version
  return 5
}
