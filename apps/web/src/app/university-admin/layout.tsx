import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'

// Оболочка админа вуза: доступ только UNIVERSITY_ADMIN (RoleGuard), навигация по структуре.
export default function Layout({ children }: { children: ReactNode }) {
  return <RoleGuard allow={[Role.UNIVERSITY_ADMIN]}>{children}</RoleGuard>
}
