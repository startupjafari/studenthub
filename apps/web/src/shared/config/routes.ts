import { Role } from '@studenthub/shared-types'

// Ролевой редирект (docs/PROJECT.md §12, docs/FRONTEND_RULES.md §3).
// Строковые литералы ролей в компонентах запрещены — импортируй ROLE_HOME отсюда.
export const ROLE_HOME: Record<Role, string> = {
  [Role.PLATFORM_ADMIN]: '/platform-admin',
  [Role.PLATFORM_MODERATOR]: '/moderator/platform',
  [Role.UNIVERSITY_ADMIN]: '/university-admin',
  [Role.UNIVERSITY_MODERATOR]: '/moderator/university',
  [Role.DEAN]: '/dean',
  [Role.TEACHER]: '/teacher',
  // Староста — студент с доп-правами: его дом, как у студента, — лента. Управление
  // группой доступно вкладками секции «Староста» (см. STAROSTA_NAV).
  [Role.STAROSTA]: '/',
  [Role.STUDENT]: '/',
  // Работодатель живёт только в карьерном продукте: разделов платформы (лента,
  // расписание, документы вуза) у него нет вовсе.
  [Role.EMPLOYER]: '/employer',
}

// Юридические документы — отдельные публичные страницы, а не модалка: на них ссылаются
// из формы входа и из заявки вуза, их шлют ссылкой и открывают из писем, а ещё их
// требуется показать до регистрации. Пути лежат здесь, потому что их обязаны знать
// одинаково и ссылки, и middleware (список публичных путей): разъедутся — документ
// станет недоступен ровно тому, кому он и нужен, человеку без аккаунта.
export const LEGAL_BASE = '/legal'
export const LEGAL_ROUTES = {
  privacy: `${LEGAL_BASE}/privacy`,
  terms: `${LEGAL_BASE}/terms`,
} as const

/** Какой из двух документов показывает страница. */
export type LegalDoc = keyof typeof LEGAL_ROUTES
