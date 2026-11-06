import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../../shared/session/role-guard'
import { MessagesScope } from '../../../i18n/messages-scope'

// Зона роли platform-moderator: доступ только PLATFORM_MODERATOR (RoleGuard). Сайдбар и навигация — общая оболочка
// корневого layout (PersistentShell): между зонами она не пересоздаётся.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={[Role.PLATFORM_MODERATOR]}>
      <MessagesScope scope="moderator/platform">{children}</MessagesScope>
    </RoleGuard>
  )
}
