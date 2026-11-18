import type { ReactNode } from 'react'
import { MessagesScope } from '../../i18n/messages-scope'

// Область словаря страницы ссылки на набор стикеров (src/i18n/messages-scope.tsx).
export default function Layout({ children }: { children: ReactNode }) {
  return <MessagesScope scope="addstickers">{children}</MessagesScope>
}
