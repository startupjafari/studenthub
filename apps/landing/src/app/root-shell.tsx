import type { ReactNode } from 'react'
// Ось opsz, а не только wght: Inter меняет пропорции и трекинг вместе с кеглем.
// Тот же пакет и тот же приём, что в платформе, — шрифт локальный, без Google Fonts.
import '@fontsource-variable/inter/opsz.css'
import type { Locale } from '../config/site'
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
      <body>{children}</body>
    </html>
  )
}
