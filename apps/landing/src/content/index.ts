import type { Locale } from '../config/site'
import type { Dictionary } from './types'
import { ru } from './ru'
import { kk } from './kk'
import { en } from './en'

/**
 * Словари всех языков. Загружаются статически: страниц три, они собираются на билде,
 * и подгружать перевод по требованию здесь нечего и незачем.
 */
const DICTIONARIES: Record<Locale, Dictionary> = { ru, kk, en }

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

export type { Dictionary } from './types'
