import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { MessagesScope } from '../../i18n/messages-scope'

// Редактор кампуса — отдельная страница без оболочки (§12.1, решение владельца): правят
// администратор и модератор вуза, платформенный админ — для поддержки.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={[Role.UNIVERSITY_ADMIN, Role.UNIVERSITY_MODERATOR, Role.PLATFORM_ADMIN]}>
      <MessagesScope scope="campus-editor">{children}</MessagesScope>
    </RoleGuard>
  )
}
