import type { ReleaseNote, ReleaseNoteContent } from '../model/types'

/**
 * Текст ноты на языке интерфейса. Нет перевода — отдаём русский: общий fallback
 * приложения (FRONTEND_RULES §10), и он лучше пустого окна.
 */
export function noteContent(note: ReleaseNote, locale: string): ReleaseNoteContent {
  const translated = note.content[locale as keyof typeof note.content]
  return translated ?? note.content.ru
}
