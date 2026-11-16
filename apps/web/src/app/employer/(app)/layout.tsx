import type { ReactNode } from 'react'
import { Role } from '@studenthub/shared-types'
import { RoleGuard } from '../../../shared/session/role-guard'
import { MessagesScope } from '../../../i18n/messages-scope'

// Зона работодателя: разделов платформы у него нет вовсе, только карьерный продукт.
// Публичные страницы (/employer/signup, /employer/verify) в эту зону не входят — у них
// свои layout'ы без RoleGuard, а общая оболочка их пропускает (widgets/app-shell/model/shell-paths).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow={[Role.EMPLOYER]}>
      <MessagesScope scope="employer/(app)">{children}</MessagesScope>
    </RoleGuard>
  )
}
