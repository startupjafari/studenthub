/**
 * Ключевые слова эмодзи для подсказок в поле ввода (Telegram EmojiTooltip): `:смех` и
 * знакомое слово под курсором предлагают смайлы.
 *
 * Словари — emojibase-data (CLDR-аннотации и теги, MIT) в компактном виде. Грузятся
 * отдельным чанком по первому запросу, не в основном бандле, и только из своей сборки:
 * сторонний CDN в рантайме не трогаем. Казахского словаря в CLDR-наборе emojibase нет —
 * для `kk` берём русский и английский: в чатах вузов Казахстана пишут на обоих.
 */

/** Запись компактного словаря emojibase — ровно те поля, что читаем. */
export interface RawEmoji {
  unicode: string
  label?: string
  tags?: string[]
  group?: number
  order?: number
}

type DictLocale = 'ru' | 'en'

/**
 * Загрузчики словарей. Импорт статической строкой — сборщик видит его и кладёт файл в свой
 * чанк, который тянется только при вызове.
 */
const LOADERS: Record<DictLocale, () => Promise<RawEmoji[]>> = {
  ru: () => import('emojibase-data/ru/compact.json').then((m) => m.default as RawEmoji[]),
  en: () => import('emojibase-data/en/compact.json').then((m) => m.default as RawEmoji[]),
}

/** Какие словари нужны интерфейсу: свой язык и английский (его теги знают все). */
export function dictLocalesFor(locale: string): DictLocale[] {
  return locale === 'en' ? ['en'] : ['ru', 'en']
}

/** Компоненты (тона кожи, волосы) и региональные буквы — не смайлы для подсказки. */
const COMPONENT_GROUP = 2

export function normalizeKeyword(word: string): string {
  return word.toLowerCase().replace(/ё/g, 'е').trim()
}

export interface EmojiKeywordIndex {
  /**
   * Поиск по `:запросу`: точное совпадение ключа выше начала слова, дальше — порядок
   * Unicode (частые лица раньше редких символов). Ищем по тегам и словам названия.
   */
  search: (query: string, limit: number) => string[]
  /**
   * Подсказка по слову под курсором: только точное совпадение с тегом или названием из
   * одного слова — «кот» предлагает 🐱, а «ко» не предлагает ничего.
   */
  exact: (word: string, limit: number) => string[]
}

/** Собрать индекс из словарей (порядок словарей не важен: смайл один на всех). */
export function buildEmojiKeywordIndex(dicts: RawEmoji[][]): EmojiKeywordIndex {
  const order = new Map<string, number>()
  // Ключ → смайлы: название целиком (самое точное: «огонь» — это 🔥, а не ❤️‍🔥 с тегом
  // «огонь»), тег и слово из названия.
  const labels = new Map<string, Set<string>>()
  const tags = new Map<string, Set<string>>()
  const words = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, key: string, emoji: string): void => {
    const k = normalizeKeyword(key)
    if (k.length < 2) return
    let set = map.get(k)
    if (!set) map.set(k, (set = new Set()))
    set.add(emoji)
  }

  for (const dict of dicts) {
    for (const e of dict) {
      if (e.group === undefined || e.group === COMPONENT_GROUP || !e.unicode) continue
      if (!order.has(e.unicode)) order.set(e.unicode, e.order ?? Number.MAX_SAFE_INTEGER)
      for (const tag of e.tags ?? []) add(tags, tag, e.unicode)
      if (e.label) {
        add(labels, e.label, e.unicode)
        for (const word of e.label.split(/[^\p{L}\p{N}]+/u)) {
          if (word.length >= 3) add(words, word, e.unicode)
        }
      }
    }
  }
  const keys = [...new Set([...labels.keys(), ...tags.keys(), ...words.keys()])]
  const byOrder = (a: string, b: string): number =>
    (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER)

  return {
    search(query, limit) {
      const q = normalizeKeyword(query)
      if (!q) return []
      const score = new Map<string, number>()
      const mark = (emojis: Set<string> | undefined, s: number): void => {
        for (const emoji of emojis ?? []) {
          const prev = score.get(emoji)
          if (prev === undefined || s < prev) score.set(emoji, s)
        }
      }
      for (const key of keys) {
        if (!key.startsWith(q)) continue
        // Точные совпадения — 0..2, начало слова — 3..5; внутри — название, тег, слово.
        const base = key === q ? 0 : 3
        mark(labels.get(key), base)
        mark(tags.get(key), base + 1)
        mark(words.get(key), base + 2)
      }
      return [...score.keys()]
        .sort((a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0) || byOrder(a, b))
        .slice(0, limit)
    },
    exact(word, limit) {
      const key = normalizeKeyword(word)
      const byLabel = [...(labels.get(key) ?? [])].sort(byOrder)
      const byTag = [...(tags.get(key) ?? [])].filter((e) => !byLabel.includes(e)).sort(byOrder)
      return [...byLabel, ...byTag].slice(0, limit)
    },
  }
}

const cache = new Map<string, Promise<EmojiKeywordIndex>>()

/** Индекс для языка интерфейса; словари грузятся один раз за сессию. */
export function loadEmojiKeywords(locale: string): Promise<EmojiKeywordIndex> {
  const locales = dictLocalesFor(locale)
  const key = locales.join('+')
  let pending = cache.get(key)
  if (!pending) {
    pending = Promise.all(locales.map((l) => LOADERS[l]())).then(buildEmojiKeywordIndex)
    // Сбой загрузки чанка (офлайн, новая сборка) не должен запоминаться навсегда.
    pending.catch(() => cache.delete(key))
    cache.set(key, pending)
  }
  return pending
}
