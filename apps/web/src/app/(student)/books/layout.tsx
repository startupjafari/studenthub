import type { ReactNode } from 'react'
import { MessagesScope } from '../../../i18n/messages-scope'

// Область словаря: пространства имён страниц раздела приходят с этим layout'ом, а не в общем
// словаре каждой страницы (src/i18n/messages-scope.tsx, задача 21.B4).
export default function Layout({ children }: { children: ReactNode }) {
  return <MessagesScope scope="(student)/books">{children}</MessagesScope>
}
