import type { Metadata, Viewport } from 'next'
import { getLocale, getMessages, getTimeZone } from 'next-intl/server'
import '@fontsource-variable/inter'
import { AppProviders } from './providers'
import { Toaster } from '../shared/ui'
import './globals.css'

export const metadata: Metadata = {
  title: 'StudentHub',
  description: 'Закрытая многоролевая образовательная платформа для университетов',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'StudentHub', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
}

// Корневой layout (Server Component): достаёт locale/messages на сервере и оборачивает в провайдеры.
// Шрифт — Inter Variable из @fontsource-variable/inter (локальные woff2, без Google Fonts —
// offline-safe). Стек задаётся токеном --font-sans в globals.css.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  // timeZone задан в i18n/request.ts; прокидываем в клиентский провайдер, иначе
  // next-intl на клиенте падает ENVIRONMENT_FALLBACK при форматировании дат.
  const timeZone = await getTimeZone()

  return (
    <html lang={locale}>
      <body>
        <AppProviders locale={locale} messages={messages} timeZone={timeZone}>
          {children}
        </AppProviders>
        <Toaster />
      </body>
    </html>
  )
}
