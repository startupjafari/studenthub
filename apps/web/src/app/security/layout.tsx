import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { MessagesScope } from '../../i18n/messages-scope'

// Оболочка охраны вуза: доступ только SECURITY_GUARD (RoleGuard) + единый сайдбар/топбар.
// Сканер, проверка студенческого и настройки — общие экраны группы (student); куда ещё
// охране можно, решает middleware (isRestrictedRolePath).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={[Role.SECURITY_GUARD]}>
      <MessagesScope scope="security">{children}</MessagesScope>
    </RoleGuard>
  )
}
