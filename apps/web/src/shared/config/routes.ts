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
}
