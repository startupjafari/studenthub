import type { Metadata, Viewport } from 'next'
import { getLocale, getMessages, getTimeZone } from 'next-intl/server'
// Сборка с осью opsz, а не только wght: Inter меняет пропорции и трекинг вместе с кеглем
// (apple-design §15 — «шрифт должен менять форму с размером»). Тот же пакет, тот же вес
// загрузки, включается одной строкой; без неё font-optical-sizing в globals.css ни на что
// не влияет, потому что оси в шрифте просто нет.
import '@fontsource-variable/inter/opsz.css'
import { AppSplash } from '../shared/ui/app-splash'
import { PlatformGate } from '../widgets/platform-gate'
import { PersistentShell, ROLE_TO_VARIANT, type NavVariant } from '../widgets/app-shell'
import { getServerSession } from '../shared/session/server'
import { pickMessages, ROOT_SCOPE } from '../i18n/pick-messages'
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
  // Пинч-зум не запрещаем (WCAG 1.4.4, Lighthouse/axe meta-viewport): кому-то без него текст
  // не прочитать. Зум при фокусе на поле снимает правило 16px для тач-экранов в globals.css.
  // Клавиатура ужимает layout-viewport (и svh/dvh) — поле ввода чата остаётся над клавиатурой (iOS/Android).
  interactiveWidget: 'resizes-content',
}

// Корневой layout (Server Component): достаёт locale/messages на сервере и оборачивает в провайдеры.
// Шрифт — Inter Variable из @fontsource-variable/inter (локальные woff2, без Google Fonts —
// offline-safe). Стек задаётся токеном --font-sans в globals.css.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  // Клиенту — не весь словарь (~400 КБ строкой в каждом HTML), а только пространства имён
  // оболочки и провайдеров. Остальное досылают layout'ы зон через <MessagesScope>
  // (src/i18n/messages-scope.tsx, состав — src/i18n/message-scopes.json).
  const messages = pickMessages(await getMessages(), ROOT_SCOPE)
  // timeZone задан в i18n/request.ts; прокидываем в клиентский провайдер, иначе
  // next-intl на клиенте падает ENVIRONMENT_FALLBACK при форматировании дат.
  const timeZone = await getTimeZone()
  // Вариант навигации до загрузки профиля — по роли из role-cookie, чтобы сайдбар не
  // мелькал студенческим у других ролей; AppShell затем подтверждает его по /users/me.
  const session = await getServerSession()
  const variant: NavVariant = session ? ROLE_TO_VARIANT[session.role] : 'student'

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
          {/* Оболочка (сайдбар, нижняя навигация) — здесь, а не в ролевых layout'ах: корневой
              layout не размонтируется никогда, и при переходе между зонами меняется только
              область контента. Страницы без оболочки (вход, публичные ссылки) она
              пропускает сама — widgets/app-shell/model/shell-paths.ts. */}
          <div className="sh-boot">
            <PlatformGate>
              <PersistentShell locale={locale} variant={variant}>
                {children}
              </PersistentShell>
            </PlatformGate>
          </div>
        </AppProviders>
      </body>
    </html>
  )
}
