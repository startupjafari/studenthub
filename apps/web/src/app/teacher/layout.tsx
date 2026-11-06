import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { MessagesScope } from '../../i18n/messages-scope'

// Зона роли teacher: доступ только TEACHER (RoleGuard). Сайдбар и навигация — общая оболочка
// корневого layout (PersistentShell): между зонами она не пересоздаётся.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={[Role.TEACHER]}>
      <MessagesScope scope="teacher">{children}</MessagesScope>
    </RoleGuard>
  )
}
