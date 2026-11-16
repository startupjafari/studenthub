import type { ReactNode } from 'react'
import { getMessages } from 'next-intl/server'
import { pickMessages } from './pick-messages'
import { ScopedMessagesProvider } from './scoped-messages-provider'

/**
 * Область словаря (задача 21.B4): корневой layout отдаёт клиенту только пространства имён
 * оболочки, а layout зоны оборачивает детей в `<MessagesScope scope="<путь каталога>">` и
 * досылает то, что нужно её страницам. Состав областей считает
 * `pnpm --filter web i18n:scopes` по импортам клиентского кода (scripts/i18n-scopes.mjs);
 * `scope` — путь каталога layout'а внутри src/app, генератор сверяет его с файлом.
 *
 * Серверным компонентам это не нужно: `getTranslations` читает полный словарь запроса.
 */
export async function MessagesScope({ scope, children }: { scope: string; children: ReactNode }) {
  const messages = pickMessages(await getMessages(), scope)
  if (Object.keys(messages).length === 0) return <>{children}</>
  return <ScopedMessagesProvider messages={messages}>{children}</ScopedMessagesProvider>
}
