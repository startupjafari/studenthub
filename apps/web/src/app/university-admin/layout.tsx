import type { ReactNode } from 'react'
import { getLocale } from 'next-intl/server'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../shared/session/role-guard'
import { AppShell } from '../../widgets/app-shell'

// Оболочка админа вуза: доступ только UNIVERSITY_ADMIN (RoleGuard), навигация по структуре.
export default async function Layout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <RoleGuard allow={[Role.UNIVERSITY_ADMIN]}>
      <AppShell locale={locale} variant="university-admin">
        {children}
      </AppShell>
    </RoleGuard>
  )
}
