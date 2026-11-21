// Общие форматтеры дат. `toLocaleDateString(locale, options)` на каждый вызов собирает новый
// `Intl.DateTimeFormat` — это дорого: лента чата подписывает время у каждого сообщения и день
// у плавающей пилюли на каждом кадре прокрутки, и профиль показывал сотни миллисекунд только
// на сборку форматтеров. Здесь форматтер создаётся один раз на пару «локаль + опции».

const cache = new Map<string, Intl.DateTimeFormat>()

/** Форматтер из кэша; опции сравниваются по содержимому, порядок ключей важен. */
export function dateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    cache.set(key, f)
  }
  return f
}

/** То же, что `date.toLocale*String(locale, options)`, но без сборки форматтера на вызов. */
export function formatDate(
  date: Date | string | number,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return dateFormatter(locale, options).format(date instanceof Date ? date : new Date(date))
}
