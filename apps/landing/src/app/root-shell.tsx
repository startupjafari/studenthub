import type { ReactNode } from 'react'
// Ось opsz, а не только wght: Inter меняет пропорции и трекинг вместе с кеглем.
// Тот же пакет и тот же приём, что в платформе, — шрифт локальный, без Google Fonts.
import '@fontsource-variable/inter/opsz.css'
// Дисплейная гарнитура заголовков. Ось wght — у Onest она единственная переменная.
import '@fontsource-variable/onest/wght.css'
import type { Locale } from '../config/site'
import { Splash } from '../ui/splash'
import './globals.css'

/**
 * Общая оболочка документа.
 *
 * У лендинга три корневых layout — по одному на язык, — потому что `<html lang>` обязан
 * соответствовать содержимому страницы: его читают скринридеры, переносы слов и поисковики.
 * Из одного общего layout атрибут не переопределить, а подменять его скриптом на клиенте
 * значит отдавать роботам и читалкам заведомо неверный язык.
 *
 * Чтобы три layout не разъехались, вся разметка документа живёт здесь, а каждый из них —
 * три строки вызова.
 */
export function RootShell({ lang, children }: { lang: Locale; children: ReactNode }) {
  return (
    <html lang={lang}>
      <body>
        {/* Первым узлом body: заставка должна попасть в первую отрисовку, иначе накрыла бы
            уже показанную страницу. Уходит сама, анимацией (globals.css, «Заставка запуска»).
            Обёртка `.sh-boot` даёт странице проявиться под уходящим полотном — полотно при
            этом остаётся снаружи неё и в проявлении не участвует. */}
        <Splash />
        <div className="sh-boot">{children}</div>
      </body>
    </html>
  )
}
