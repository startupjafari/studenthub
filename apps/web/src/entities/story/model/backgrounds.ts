import { STORY_BACKGROUNDS, type StoryBackgroundValue } from '@studenthub/shared-schemas'

// Чем рисуется фон текстовой сторис. Ключи закрыты схемой (shared-schemas), а их
// оформление — знание фронта: сервер хранит ключ, а не цвет, поэтому палитру можно
// перерисовать, не трогая уже опубликованные сторисы.
//
// Оттенки сырые, как у BRAND_GRADIENT: это декоративная заливка, а не статус, и роли
// в дизайн-системе у неё нет (docs/DESIGN_SYSTEM.md §2.2).
export const STORY_BACKGROUND_CLASS: Record<StoryBackgroundValue, string> = {
  sunset: 'bg-gradient-to-br from-orange-400 via-rose-500 to-fuchsia-600',
  ocean: 'bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600',
  forest: 'bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600',
  grape: 'bg-gradient-to-br from-violet-500 via-purple-600 to-fuchsia-700',
  graphite: 'bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900',
  rose: 'bg-gradient-to-br from-pink-400 via-rose-500 to-red-500',
}

export const STORY_BACKGROUND_VALUES = STORY_BACKGROUNDS

/** Фон кадра: выбранный ключ, а при его отсутствии — нейтральный графит. */
export function storyBackgroundClass(background: string | null): string {
  if (background && background in STORY_BACKGROUND_CLASS) {
    return STORY_BACKGROUND_CLASS[background as StoryBackgroundValue]
  }
  return STORY_BACKGROUND_CLASS.graphite
}
