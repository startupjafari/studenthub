import type { ReactNode } from 'react'
import type { Role } from '@studenthub/shared-types'
import { Forbidden } from '../ui'
import { getServerSession } from './server'

// Server-компонент: рендерит контент только для разрешённых ролей, иначе 403 (§3).
export async function RoleGuard({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const session = await getServerSession()
  if (!session || !allow.includes(session.role)) {
    return <Forbidden />
  }
  return <>{children}</>
}
