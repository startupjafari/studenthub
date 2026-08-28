'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

// Последний рубеж: срабатывает, когда упал сам корневой layout — т.е. когда обычные
// error.tsx отрисовать уже нечем. Поэтому здесь есть <html>/<body> (Ф13.8).
//
// ДВА ОСОЗНАННЫХ ОТСТУПЛЕНИЯ ОТ ПРАВИЛ, ДЕЙСТВУЮЩИЕ ТОЛЬКО В ЭТОМ ФАЙЛЕ:
// 1. Текст не из i18n (§10). global-error рендерится ВНЕ корневого layout, значит вне
//    NextIntlClientProvider — useTranslations здесь бросает. Тянуть сюда весь словарь
//    ради двух строк дороже, чем эти две строки. Язык — ru (DEFAULT_LOCALE).
// 2. Инлайн-стили вместо Tailwind (§9). globals.css импортируется тем самым layout'ом,
//    который только что упал; полагаться на его стили нельзя.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: {
        source: 'global-error',
        ...(error.digest ? { next_digest: error.digest } : {}),
      },
    })
  }, [error])

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Что-то пошло не так
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '1.5rem' }}>
            Мы уже знаем о проблеме. Попробуйте обновить страницу.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              background: '#2563eb',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            На главную
          </a>
        </main>
      </body>
    </html>
  )
}
