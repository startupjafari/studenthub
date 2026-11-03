import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'

// Оболочка библиотекаря вуза: доступ только LIBRARIAN (RoleGuard) + единый сайдбар/топбар.
// Сканер и настройки — общие экраны группы (student); куда ещё библиотекарю можно, решает
// middleware (isRestrictedRolePath).
export default function Layout({ children }: { children: ReactNode }) {
  return <RoleGuard allow={[Role.LIBRARIAN]}>{children}</RoleGuard>
}
