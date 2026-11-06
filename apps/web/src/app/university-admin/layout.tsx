import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { MessagesScope } from '../../i18n/messages-scope'

// Оболочка админа вуза: доступ только UNIVERSITY_ADMIN (RoleGuard), навигация по структуре.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={[Role.UNIVERSITY_ADMIN]}>
      <MessagesScope scope="university-admin">{children}</MessagesScope>
    </RoleGuard>
  )
}
