'use client'

import { useCallback, useRef, useState, type RefObject } from 'react'
import { loadEmojiKeywords, type EmojiKeywordIndex } from '../../../shared/lib/emoji-keywords'
import { isEmojiSupported } from '../../../shared/lib/emoji-support'
import type { RichTextHandle } from '../../../shared/ui'

/** Сколько смайлов в подсказке: по `:запросу` ищут — показываем ряд пошире. */
const COLON_LIMIT = 24
const WORD_LIMIT = 8
/** Берём с запасом: часть кандидатов отсеет проверка шрифта (см. isEmojiSupported). */
const OVERFETCH = 2

/**
 * `:запрос` у курсора: двоеточие в начале строки или после пробела, от двух знаков. Хвостовое
 * `:` (`:огонь:`) — «вставь первый и не спрашивай», как в Telegram.
 */
const COLON_RE = /(?:^|\s):([\p{L}\p{N}_+-]{2,32})(:?)$/u
/** Слово прямо перед курсором — от двух букв, без цифр и знаков. */
const WORD_RE = /(?:^|[\s(«"'„])(\p{L}{2,32})$/u

export type EmojiSuggestionMode = 'colon' | 'word'

export interface EmojiSuggestions {
  mode: EmojiSuggestionMode
  /** Что заменит выбранный смайл: длина хвоста текста перед курсором. */
  replaceLength: number
  items: string[]
}

export type EmojiMatch =
  | { mode: 'colon'; query: string; closed: boolean; replaceLength: number }
  | { mode: 'word'; query: string; replaceLength: number }

/** Что перед курсором просит подсказки. Чистая функция — её и проверяют тесты. */
export function matchEmojiQuery(before: string): EmojiMatch | null {
  const colon = COLON_RE.exec(before)
  if (colon?.[1]) {
    const closed = colon[2] === ':'
    return {
      mode: 'colon',
      query: colon[1],
      closed,
      replaceLength: colon[1].length + 1 + (closed ? 1 : 0),
    }
  }
  const word = WORD_RE.exec(before)
  if (word?.[1]) return { mode: 'word', query: word[1], replaceLength: word[1].length }
  return null
}

/**
 * Подсказка эмодзи у поля ввода (Telegram EmojiTooltip): по `:запросу` — поиск по началу
 * ключевых слов, по слову под курсором — смайлы с таким ключевым словом («кот» → 🐱).
 *
 * Текст до курсора читается у поля в момент правки (`update` из onChange), а не по
 * значению-markdown: позиция курсора из markdown не восстанавливается. Перед заменой хвост
 * сверяется ещё раз — курсор мог уйти, и стирать тогда нечего.
 *
 * Словари грузятся при первом подходящем слове, а не при открытии чата.
 */
export function useEmojiSuggestions(
  locale: string,
  composerRef: RefObject<RichTextHandle | null>,
): {
  suggestions: EmojiSuggestions | null
  activeIndex: number
  setActiveIndex: (index: number) => void
  update: () => void
  pick: (emoji: string) => void
  close: () => void
  onKey: (e: KeyboardEvent) => boolean
} {
  const [suggestions, setSuggestions] = useState<EmojiSuggestions | null>(null)
  const [active, setActive] = useState({ key: '', index: 0 })
  const indexRef = useRef<EmojiKeywordIndex | null>(null)
  const loading = useRef(false)
  // Хвост, по которому подсказку закрыли Esc: тот же запрос её больше не поднимает.
  const dismissed = useRef<string | null>(null)

  const key = suggestions ? suggestions.items.join('') : ''
  const activeIndex = active.key === key ? active.index : 0
  const setActiveIndex = useCallback((index: number) => setActive({ key, index }), [key])

  const replace = useCallback(
    (emoji: string, match: EmojiMatch) => {
      composerRef.current?.insertText(emoji, match.replaceLength)
      dismissed.current = null
      setSuggestions(null)
    },
    [composerRef],
  )

  const compute = useCallback(
    (before: string, index: EmojiKeywordIndex) => {
      const match = matchEmojiQuery(before)
      if (!match || dismissed.current === before) {
        setSuggestions(null)
        return
      }
      const limit = match.mode === 'colon' ? COLON_LIMIT : WORD_LIMIT
      const found =
        match.mode === 'colon'
          ? index.search(match.query, limit * OVERFETCH)
          : index.exact(match.query, limit * OVERFETCH)
      const items = found.filter(isEmojiSupported).slice(0, limit)
      if (items.length === 0) {
        setSuggestions(null)
        return
      }
      const first = items[0]
      if (match.mode === 'colon' && match.closed && first) {
        // Не изнутри обработчика правки: вставка — новая транзакция редактора, и её лучше
        // отдать после того, как текущая договорит своё обновление.
        queueMicrotask(() => replace(first, match))
        return
      }
      setSuggestions({ mode: match.mode, replaceLength: match.replaceLength, items })
    },
    [replace],
  )

  const update = useCallback(() => {
    const before = composerRef.current?.textBefore() ?? ''
    if (!matchEmojiQuery(before)) {
      setSuggestions(null)
      return
    }
    const index = indexRef.current
    if (index) {
      compute(before, index)
      return
    }
    if (loading.current) return
    loading.current = true
    void loadEmojiKeywords(locale)
      .then((loaded) => {
        indexRef.current = loaded
        // Пока словарь ехал, человек допечатал — считаем по тому, что перед курсором сейчас.
        compute(composerRef.current?.textBefore() ?? '', loaded)
      })
      .catch(() => undefined)
      .finally(() => {
        loading.current = false
      })
  }, [composerRef, compute, locale])

  const pick = useCallback(
    (emoji: string) => {
      const match = matchEmojiQuery(composerRef.current?.textBefore() ?? '')
      if (!match) {
        setSuggestions(null)
        return
      }
      replace(emoji, match)
    },
    [composerRef, replace],
  )

  const close = useCallback(() => {
    dismissed.current = composerRef.current?.textBefore() ?? null
    setSuggestions(null)
  }, [composerRef])

  /**
   * Клавиши поля, пока подсказка открыта. По `:запросу` ←/→ ходят по ряду, Enter/Tab
   * вставляют; по слову под курсором Enter остаётся отправкой («ок» + Enter не должно
   * превращаться в 👌), вставляет только Tab, а стрелки двигают курсор и гасят подсказку.
   */
  const onKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!suggestions) return false
      const n = suggestions.items.length
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return true
      }
      if (suggestions.mode === 'colon') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          setActiveIndex((activeIndex + (e.key === 'ArrowRight' ? 1 : n - 1)) % n)
          return true
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          const emoji = suggestions.items[Math.min(activeIndex, n - 1)]
          if (emoji) pick(emoji)
          return true
        }
        return false
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        const emoji = suggestions.items[0]
        if (emoji) pick(emoji)
        return true
      }
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') setSuggestions(null)
      return false
    },
    [suggestions, activeIndex, setActiveIndex, close, pick],
  )

  return { suggestions, activeIndex, setActiveIndex, update, pick, close, onKey }
}
