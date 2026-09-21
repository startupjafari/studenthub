import type { Metadata, Viewport } from 'next'
import { getLocale, getMessages, getTimeZone } from 'next-intl/server'
// Сборка с осью opsz, а не только wght: Inter меняет пропорции и трекинг вместе с кеглем
// (apple-design §15 — «шрифт должен менять форму с размером»). Тот же пакет, тот же вес
// загрузки, включается одной строкой; без неё font-optical-sizing в globals.css ни на что
// не влияет, потому что оси в шрифте просто нет.
import '@fontsource-variable/inter/opsz.css'
import { AppSplash } from '../shared/ui'
import { PlatformGate } from '../widgets/platform-gate'
import { AppProviders } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'StudentHub',
  description: 'Закрытая многоролевая образовательная платформа для университетов',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'StudentHub', statusBarStyle: 'default' },
  // iOS не поддерживает SVG для apple-touch-icon — отдаём PNG 180×180 на белом фоне.
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  // Полностью отключаем масштабирование на мобильных (iOS/Android): без пинч-зума и зума при фокусе.
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  // Клавиатура ужимает layout-viewport (и svh/dvh) — поле ввода чата остаётся над клавиатурой (iOS/Android).
  interactiveWidget: 'resizes-content',
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
    // suppressHydrationWarning — next-themes выставляет класс темы на <html> до гидрации.
    <html lang={locale} suppressHydrationWarning>
      <body>
        {/* Первым узлом body и вне провайдеров: заставка должна попасть в первую отрисовку,
            до гидратации, — иначе она накрыла бы уже показанное приложение. Уходит сама,
            анимацией (globals.css, «Заставка запуска»). */}
        <AppSplash />
        <AppProviders locale={locale} messages={messages} timeZone={timeZone}>
          {/* Обёртка нужна анимации запуска: приложение проявляется под уходящим полотном.
              Держит только содержимое страниц — полотно осталось снаружи, а тосты и палитра
              команд рендерятся провайдерами рядом. Своих стилей раскладки у неё нет: цепочка
              высот не меняется, анимируется одна прозрачность (globals.css, `.sh-boot`). */}
          {/* PlatformGate внутри обёртки, а не снаружи: объявление проявляется вместе с
              приложением, а заглушка техработ — под уходящим полотном, без вспышки. */}
          <div className="sh-boot">
            <PlatformGate>{children}</PlatformGate>
          </div>
        </AppProviders>
      </body>
    </html>
  )
}
