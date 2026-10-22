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
  // Охрана вуза — свой раздел: сканер, проверка студенческого, помещения, камеры.
  [Role.SECURITY_GUARD]: '/security',
  // Библиотекарь — свой раздел: каталог, выдача и возврат книг (Фаза 20).
  [Role.LIBRARIAN]: '/library',
}

/**
 * Куда пускать роли с запретом по умолчанию (`RESTRICTED_ROLES`, docs/PROJECT.md §2) — тот
 * же принцип «разрешено только по списку», что у RestrictedRoleGuard на сервере. Остальные
 * экраны платформы им не нужны, а открытые прямой ссылкой показали бы стену ошибок `403`:
 * middleware ведёт на главную роли. Сканер, проверка студенческого и настройки живут в
 * общей группе `(student)`, поэтому перечислены здесь, а не закрыты одним префиксом.
 */
const ACCOUNT_PATHS = ['/settings', '/setup-2fa', '/qr'] as const

const RESTRICTED_ROLE_PATHS: Partial<Record<Role, readonly string[]>> = {
  // Подтверждение входа на компьютере по QR (`/qr?t=`) и страница помещения (`/r/<код>`).
  [Role.SECURITY_GUARD]: ['/security', '/scan', '/verify-id', '/r', ...ACCOUNT_PATHS],
  // Сканер — для входа на компьютере; удостоверения читателей добавит выдача книг (20.4).
  [Role.LIBRARIAN]: ['/library', '/scan', ...ACCOUNT_PATHS],
}

/** Можно ли роли с запретом по умолчанию открыть этот путь. Остальным ролям — всегда да. */
export function isRestrictedRolePath(role: Role, pathname: string): boolean {
  const paths = RESTRICTED_ROLE_PATHS[role]
  if (!paths) return true
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))
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
