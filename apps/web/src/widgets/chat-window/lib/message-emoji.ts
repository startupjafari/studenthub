// Сообщение из одних эмодзи (Telegram): 1–3 эмодзи рисуются крупно и без пузыря.

/** Больше этого числа эмодзи — обычный пузырь с текстом. */
export const BIG_EMOJI_MAX = 3

const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u
// Буквы, цифры без колпачка и знаки внутри графемы — уже не «чистый» эмодзи.
const NON_EMOJI = /[\p{L}\p{N}\p{P}\p{S}]/u
const EMOJI_PARTS =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|\uFE0F|\u200D|\u20E3/gu

let segmenter: Intl.Segmenter | null | undefined

function graphemes(text: string): string[] | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null
  }
  if (!segmenter) return null
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

/**
 * Сколько эмодзи в сообщении, если оно состоит только из них (пробелы не в счёт), иначе 0.
 * Без `Intl.Segmenter` (очень старые браузеры) — всегда 0: обычный пузырь ничего не ломает.
 */
export function emojiOnlyCount(text: string): number {
  const trimmed = text.replace(/\s+/g, '')
  if (!trimmed || trimmed.length > 64) return 0
  const parts = graphemes(trimmed)
  if (!parts || parts.length > BIG_EMOJI_MAX) return 0
  for (const g of parts) {
    if (!EMOJI_GRAPHEME.test(g)) return 0
    // Что осталось после вычитания эмодзи-кусков — посторонний символ.
    if (NON_EMOJI.test(g.replace(EMOJI_PARTS, ''))) return 0
  }
  return parts.length
}
