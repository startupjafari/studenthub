import { describe, expect, it } from 'vitest'
import { LOCALES, MESSAGES } from './messages'

// Главный тест локализации — полнота словарей.
//
// Пропущенный ключ в казахском или английском не ломает сборку: `Record<MessageKey, string>`
// ловит только отсутствие ключа, но не подстановку русского текста копипастой. Проверяем
// оба случая здесь, потому что увидеть их в интерфейсе можно только сменив язык клиента
// Telegram — то есть почти никогда.

describe('словари локализации', () => {
  const keys = Object.keys(MESSAGES.ru)

  it.each(LOCALES)('в языке %s есть все ключи', (loc) => {
    expect(Object.keys(MESSAGES[loc]).sort()).toEqual(keys.sort())
  })

  it.each(LOCALES)('в языке %s нет пустых строк', (loc) => {
    const empty = keys.filter((key) => MESSAGES[loc][key as keyof typeof MESSAGES.ru].trim() === '')
    expect(empty).toEqual([])
  })

  // Подстановки должны совпадать: `{name}` в русском и его отсутствие в английском дают
  // строку с видимой фигурной скобкой вместо имени.
  it.each(LOCALES)('в языке %s те же подстановки, что в русском', (loc) => {
    const mismatched = keys.filter((key) => {
      const typed = key as keyof typeof MESSAGES.ru
      return placeholders(MESSAGES.ru[typed]) !== placeholders(MESSAGES[loc][typed])
    })
    expect(mismatched).toEqual([])
  })

  // Непереведённая строка обычно выглядит как дословная копия русской. Исключения —
  // имена собственные, технические слова и заимствования, которые в казахском пишутся
  // так же: «Платформа», «Портфолио», сокращение «мин». Список закрытый намеренно —
  // каждая новая строка здесь должна быть осознанным решением, а не способом заглушить тест.
  const SAME_BY_DESIGN = new Set([
    'appName',
    'healthRedis',
    'ageMinutes',
    'maintenanceMinutes',
    'overviewTitle',
    'sectionPortfolio',
    // «Баннер» — заимствование, в казахском пишется так же; переводить его «хабарландыру
    // жолағы» значило бы назвать в шапке раздела одним словом то, что везде зовётся баннером.
    'bannerTitle',
    // Диапазоны времени — цифры, а не слова: переводить в них нечего.
    'notifQuietNight',
    'notifQuietEvening',
    // Одни подстановки и запятая — переводить нечего.
    'changesBy',
    // Названия праздников, которые в русском и казахском пишутся одинаково: «Наурыз
    // мейрамы» и «Ораза айт» — казахские слова, и русский их не переводит, а заимствует.
    'seasonNauryz',
    'seasonOrazaAit',
  ])

  it.each(LOCALES.filter((loc) => loc !== 'ru'))('в языке %s нет копий русского текста', (loc) => {
    const copied = keys.filter((key) => {
      const typed = key as keyof typeof MESSAGES.ru
      return !SAME_BY_DESIGN.has(key) && MESSAGES[loc][typed] === MESSAGES.ru[typed]
    })
    expect(copied).toEqual([])
  })
})

function placeholders(text: string): string {
  return (text.match(/\{(\w+)\}/g) ?? []).sort().join(',')
}
