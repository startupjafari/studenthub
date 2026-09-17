/** Язык ноты. Совпадает с локалями приложения (FRONTEND_RULES §10). */
export type ReleaseLocale = 'ru' | 'kk' | 'en'

export interface ReleaseNoteItem {
  /** Эмодзи-маркер строки, как в макете. Без него строка идёт с обычным буллетом. */
  icon?: string
  /** Суть изменения — жирным началом строки. */
  title: string
  /** Что это значит на практике; обычно «раньше было так». Необязательно. */
  text?: string
}

export interface ReleaseNoteSection {
  /** Подзаголовок блока («База знаний», «Разделы и данные»). Первый блок обычно без него. */
  heading?: string
  items: ReleaseNoteItem[]
}

export interface ReleaseNoteContent {
  /** Заголовок релиза — одной фразой о главном, а не «Версия 1.7.0». */
  title: string
  /** Абзац-подводка перед списком. */
  intro?: string
  sections: ReleaseNoteSection[]
}

/**
 * Нота релиза — то, что видит пользователь в окне «Что нового».
 *
 * Тексты живут здесь, а не в `messages/*.json`, сознательно. Словари — это строки
 * интерфейса, их наборы обязаны совпадать во всех трёх локалях (`messages.test.ts`), и
 * каждый релиз требовал бы казахского и английского перевода к моменту выпуска, иначе
 * красный CI. Нота — контент: русский обязателен, остальные локали подставляются по мере
 * перевода, а до тех пор работает общий fallback на `ru`.
 */
export interface ReleaseNote {
  /** SemVer, ровно как в package.json и в теге `vX.Y.Z`. */
  version: string
  /** Дата выпуска, `YYYY-MM-DD`. */
  date: string
  /**
   * Показывать ли окно. `false` — для патчей и технических релизов: всплывающее окно
   * ради «починили опечатку» обесценивает само окно, и в следующий раз его закроют не читая.
   * Нота при этом остаётся в истории и попадает в changelog.
   */
  showModal: boolean
  content: { ru: ReleaseNoteContent } & Partial<Record<ReleaseLocale, ReleaseNoteContent>>
}
