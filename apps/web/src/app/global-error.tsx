'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

// Последний рубеж: срабатывает, когда упал сам корневой layout — т.е. когда обычные
// error.tsx отрисовать уже нечем. Поэтому здесь есть <html>/<body> (Ф13.8).
//
// ДВА ОСОЗНАННЫХ ОТСТУПЛЕНИЯ ОТ ПРАВИЛ, ДЕЙСТВУЮЩИЕ ТОЛЬКО В ЭТОМ ФАЙЛЕ:
// 1. Текст не из i18n (§10). global-error рендерится ВНЕ корневого layout, значит вне
//    NextIntlClientProvider — useTranslations здесь бросает. Тянуть сюда весь словарь
//    ради трёх строк дороже, чем эти три строки. Язык — ru (DEFAULT_LOCALE).
// 2. Свои стили вместо Tailwind (§9). globals.css импортируется тем самым layout'ом,
//    который только что упал; полагаться на его классы и токены нельзя.
//
// Стили — тегом <style>, а не инлайном: только так экран уважает тёмную тему
// (prefers-color-scheme) и prefers-reduced-motion. Инлайн-стиль медиазапросом не выключить,
// а отдавать тёмному пользователю белую вспышку во весь экран — плохой финал падения.
const STYLES = `
  :root { color-scheme: light dark; --ge-bg:#f8fafc; --ge-card:#fff; --ge-text:#0f172a;
          --ge-muted:#64748b; --ge-line:rgba(15,23,42,.10); --ge-brand:#2563eb;
          --ge-tint:rgba(37,99,235,.06); --ge-tint-2:rgba(37,99,235,.12); --ge-on-brand:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --ge-bg:#0b1120; --ge-card:#131a2a; --ge-text:#e8ecf4; --ge-muted:#94a3b8;
            --ge-line:rgba(255,255,255,.12); --ge-brand:#60a5fa;
            --ge-tint:rgba(96,165,250,.08); --ge-tint-2:rgba(96,165,250,.16);
            --ge-on-brand:#0b1120; }
  }
  body { margin:0; min-height:100dvh; display:flex; flex-direction:column; align-items:center;
         justify-content:center; gap:1.5rem; padding:1.5rem; background:var(--ge-bg);
         color:var(--ge-text); font:400 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .ge-brand { display:flex; align-items:center; gap:.5rem; font-size:.875rem; font-weight:600;
              letter-spacing:-.01em; opacity:.8; }
  .ge-brand svg { width:20px; height:20px; color:var(--ge-brand); }
  .ge-card { width:100%; max-width:28rem; overflow:hidden; border-radius:.75rem;
             background:var(--ge-card); box-shadow:0 0 0 1px var(--ge-line);
             animation:ge-in .45s cubic-bezier(.22,1,.36,1); }
  .ge-head { display:flex; align-items:center; justify-content:center; padding:1.5rem;
             background:var(--ge-tint); border-bottom:1px solid var(--ge-line); }
  .ge-chip { display:flex; align-items:center; justify-content:center; width:3.5rem;
             height:3.5rem; border-radius:.5rem; background:var(--ge-tint-2); color:var(--ge-brand); }
  .ge-chip svg { width:28px; height:28px; }
  .ge-body { padding:1.5rem; text-align:center; }
  .ge-title { margin:0; font-size:1.25rem; font-weight:600; letter-spacing:-.01em; }
  .ge-text { margin:.5rem auto 0; max-width:24rem; color:var(--ge-muted); }
  .ge-code { display:inline-block; margin-top:1rem; padding:.25rem .5rem; border-radius:.5rem;
             background:var(--ge-tint-2); color:var(--ge-muted); font-size:.75rem;
             font-family:ui-monospace,SFMono-Regular,Menlo,monospace; user-select:all; }
  .ge-actions { display:flex; flex-direction:column; gap:.5rem; margin-top:1.5rem; }
  @media (min-width:480px) { .ge-actions { flex-direction:row; justify-content:center; } }
  .ge-btn { display:inline-flex; align-items:center; justify-content:center; gap:.5rem;
            height:2.25rem; padding:0 1rem; border:0; border-radius:.75rem; cursor:pointer;
            font-family:inherit; font-size:14px; font-weight:500; line-height:1;
            text-decoration:none; }
  .ge-btn-primary { background:var(--ge-brand); color:var(--ge-on-brand); }
  .ge-btn-ghost { background:transparent; color:var(--ge-text); box-shadow:inset 0 0 0 1px var(--ge-line); }
  @keyframes ge-in { from { opacity:0; transform:translateY(10px) scale(.98) } to { opacity:1 } }
  @media (prefers-reduced-motion:reduce) { .ge-card { animation:none } }
`

export default function GlobalError({
  error,
  reset,
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
      <body>
        <style>{STYLES}</style>

        <div className="ge-brand">
          {/* Иконки lucide тянуть нельзя по той же причине, что и стили: пакет грузит
              тот же упавший бандл. Две фигуры рисуем руками. */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M22 10 12 5 2 10l10 5 10-5Z" strokeLinejoin="round" />
            <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" strokeLinecap="round" />
          </svg>
          StudentHub
        </div>

        <main className="ge-card">
          <div className="ge-head">
            <span className="ge-chip">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path
                  d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                  strokeLinejoin="round"
                />
                <path d="M12 9v4" strokeLinecap="round" />
                <path d="M12 17h.01" strokeLinecap="round" />
              </svg>
            </span>
          </div>

          <div className="ge-body">
            <h1 className="ge-title">Что-то пошло не так</h1>
            <p className="ge-text">
              Мы записали сбой и уже разбираемся. Чаще всего помогает повторить.
            </p>
            {error.digest && <span className="ge-code">Код ошибки: {error.digest}</span>}

            <div className="ge-actions">
              <button type="button" className="ge-btn ge-btn-primary" onClick={reset}>
                Попробовать снова
              </button>
              <a href="/" className="ge-btn ge-btn-ghost">
                На главную
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
