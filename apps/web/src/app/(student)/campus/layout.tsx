import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../../shared/session/role-guard'

// Карта кампуса — всем членам вуза и охране (§16.1); работодателю — нет (docs/PROJECT.md §3.13).
const VIEWERS = [
  Role.STUDENT,
  Role.STAROSTA,
  Role.TEACHER,
  Role.DEAN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.SECURITY_GUARD,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
]

export default function Layout({ children }: { children: ReactNode }) {
  return <RoleGuard allow={VIEWERS}>{children}</RoleGuard>
}
