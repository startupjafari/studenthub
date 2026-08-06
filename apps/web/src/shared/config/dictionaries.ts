// Справочник языков профиля с флагами. Значения = что сохраняется в профиль; вне списка —
// свой ввод (без флага). Навыки/интересы — в ./skills и ./interests, страны — в ./countries.

export type LanguageFlagCode =
  'ru' | 'en' | 'kk' | 'es' | 'de' | 'fr' | 'it' | 'uk' | 'zh' | 'tr' | 'ja' | 'pt'

export interface LanguageDictItem {
  value: string
  flag: LanguageFlagCode
}

export const LANGUAGES_DICT: LanguageDictItem[] = [
  { value: 'Русский', flag: 'ru' },
  { value: 'Английский', flag: 'en' },
  { value: 'Казахский', flag: 'kk' },
  { value: 'Испанский', flag: 'es' },
  { value: 'Немецкий', flag: 'de' },
  { value: 'Французский', flag: 'fr' },
  { value: 'Итальянский', flag: 'it' },
  { value: 'Украинский', flag: 'uk' },
  { value: 'Китайский', flag: 'zh' },
  { value: 'Турецкий', flag: 'tr' },
  { value: 'Японский', flag: 'ja' },
  { value: 'Португальский', flag: 'pt' },
]

export const LANGUAGE_VALUES: string[] = LANGUAGES_DICT.map((l) => l.value)

const LANG_FLAG_BY_VALUE = new Map(
  LANGUAGES_DICT.map((l) => [l.value.trim().toLowerCase(), l.flag]),
)

// Флаг по названию языка (как хранится в профиле). null — язык введён вручную/нет в справочнике.
export function languageFlagOf(value: string): LanguageFlagCode | null {
  return LANG_FLAG_BY_VALUE.get(value.trim().toLowerCase()) ?? null
}
