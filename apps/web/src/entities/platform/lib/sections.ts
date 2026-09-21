// Что именно исчезает, когда раздел погашен.
//
// Ключи разделов задаёт бэкенд (PLATFORM_SECTIONS в shared-schemas), а вот во что они
// разворачиваются на фронте — знание здешнее: у одного раздела бывает несколько пунктов
// навигации и несколько маршрутов.
//
// Административные экраны настройки сюда НЕ входят намеренно: погашен пользовательский
// раздел «Документы», а не возможность админа посмотреть его типы и доступы. Гасят раздел
// как раз тогда, когда в нём что-то сломалось, — отбирать в этот момент инструменты
// починки было бы ровно наоборот.

/** Пункты навигации, которые скрываются вместе с разделом (NavItem.key). */
const SECTION_NAV_KEYS: Record<string, readonly string[]> = {
  chats: ['chats'],
  events: ['events'],
  documents: ['documents'],
  applications: ['applications'],
  portfolio: ['portfolio'],
  career: [
    'careerHome',
    'careerProfile',
    'careerApplications',
    'careerEvents',
    'careerAnalytics',
    'vacancies',
    'vacancyReview',
    'candidates',
    'companies',
    'companyProfile',
    'universityAccess',
    'resume',
  ],
}

/** Маршруты раздела: скрыть пункт мало — по прямой ссылке страница всё равно открылась бы. */
const SECTION_PATHS: Record<string, readonly string[]> = {
  chats: ['/chats'],
  events: ['/events'],
  documents: ['/documents'],
  applications: ['/applications'],
  portfolio: ['/portfolio'],
  career: ['/career', '/employer'],
}

/** Скрыт ли пункт навигации. Неизвестный ключ раздела игнорируется, а не гасит всё подряд. */
export function isNavKeyDisabled(navKey: string, disabledSections: readonly string[]): boolean {
  return disabledSections.some((section) => SECTION_NAV_KEYS[section]?.includes(navKey) ?? false)
}

/**
 * Погашенный раздел, которому принадлежит путь, — или `null`. Сравниваем по границе
 * сегмента: `/documents-archive` не должен считаться частью `/documents`.
 */
export function disabledSectionForPath(
  pathname: string,
  disabledSections: readonly string[],
): string | null {
  for (const section of disabledSections) {
    const paths = SECTION_PATHS[section] ?? []
    if (paths.some((base) => pathname === base || pathname.startsWith(`${base}/`))) return section
  }
  return null
}
