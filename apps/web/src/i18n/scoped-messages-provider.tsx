'use client'

import { useMemo, type ReactNode } from 'react'
import {
  NextIntlClientProvider,
  useLocale,
  useMessages,
  type AbstractIntlMessages,
} from 'next-intl'

/**
 * Досыпает в словарь клиента пространства имён области. Вложенный провайдер next-intl
 * словарь родителя ЗАМЕНЯЕТ, а не дополняет, — поэтому объединяем сами. Остальное
 * (часовой пояс, форматы, обработчик ошибок) провайдер берёт у родителя.
 */
export function ScopedMessagesProvider({
  messages,
  children,
}: {
  messages: AbstractIntlMessages
  children: ReactNode
}) {
  const parent = useMessages()
  const locale = useLocale()
  const merged = useMemo(() => ({ ...parent, ...messages }), [parent, messages])
  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  )
}
