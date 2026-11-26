// Выбор локализованного поля из тройки nameRu/nameKz/nameEn по языку приложения
// (`useAppLocale()`, не тег next-intl: для казахского тот — `kk`).
const SUFFIX: Record<string, 'Ru' | 'Kz' | 'En'> = { ru: 'Ru', kz: 'Kz', en: 'En' }

export function pickLocale(obj: Record<string, unknown>, base: string, locale: string): string {
  const suf = SUFFIX[locale] ?? 'Ru'
  return (obj[`${base}${suf}`] as string | null) ?? (obj[`${base}Ru`] as string | null) ?? ''
}
