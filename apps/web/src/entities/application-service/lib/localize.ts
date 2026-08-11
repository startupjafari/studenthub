// Выбор локализованного поля из тройки nameRu/nameKk/nameEn по активной локали.
const SUFFIX: Record<string, 'Ru' | 'Kk' | 'En'> = { ru: 'Ru', kk: 'Kk', en: 'En' }

export function pickLocale(obj: Record<string, unknown>, base: string, locale: string): string {
  const suf = SUFFIX[locale] ?? 'Ru'
  return (obj[`${base}${suf}`] as string | null) ?? (obj[`${base}Ru`] as string | null) ?? ''
}
