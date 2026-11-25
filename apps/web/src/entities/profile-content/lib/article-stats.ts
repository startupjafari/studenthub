/** Скорость чтения, слов в минуту — та же, что у сервера (`readingMinutes` статьи). */
export const WORDS_PER_MINUTE = 200
/** Предел текста статьи (CreateProfileArticleSchema.content). */
export const ARTICLE_CONTENT_MAX = 20000

export interface ArticleStats {
  words: number
  chars: number
  /** 0 — текста нет: «0 минут» честнее, чем «1 минута» у пустой статьи. */
  minutes: number
}

/**
 * Статистика редактора. Слова считаются так же, как на сервере (по пробелам в тексте
 * статьи), чтобы оценка в редакторе совпала с той, что увидят читатели. Символы — длина
 * текста: по ней же сервер применяет предел.
 */
export function articleStats(content: string): ArticleStats {
  const trimmed = content.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  return {
    words,
    chars: content.length,
    minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
  }
}
