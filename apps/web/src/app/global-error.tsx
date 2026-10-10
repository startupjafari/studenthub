'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

// Последний рубеж: срабатывает, когда упал сам корневой layout — т.е. когда обычные
// error.tsx отрисовать уже нечем. Поэтому здесь есть <html>/<body> (Ф13.8).
//
// ТРИ ОСОЗНАННЫХ ОТСТУПЛЕНИЯ ОТ ПРАВИЛ, ДЕЙСТВУЮЩИЕ ТОЛЬКО В ЭТОМ ФАЙЛЕ:
// 1. Текст не из i18n (§10). global-error рендерится ВНЕ корневого layout, значит вне
//    NextIntlClientProvider — useTranslations здесь бросает. Тянуть сюда весь словарь
//    ради трёх строк дороже, чем эти три строки. Язык — ru (DEFAULT_LOCALE).
// 2. Свои стили вместо Tailwind (§9). globals.css импортируется тем самым layout'ом,
//    который только что упал; полагаться на его классы и токены нельзя.
// 3. Разметка повторяет StatusScreen руками, а не переиспользует его. Компонент тянет
//    за собой Tailwind, lucide и next-intl — всё то, чего здесь нет.
//
// ПОЧЕМУ ВСЁ-ТАКИ ПОВТОРЯЕТ. Раньше это была карточка посреди пустого экрана — свой,
// ни на что не похожий вид. Человек не отличает «упал раздел» от «упал весь layout», он
// видит одно: приложение сломалось. Два разных экрана на одно событие читаются как два
// разных продукта, поэтому вид здесь тот же, что у StatusScreen: панель во весь экран,
// подпись продукта в углу, иконка в ореоле из колец, те же кегли и те же кнопки.
//
// ЦЕНА. Токены скопированы значениями из globals.css (:root и .dark), геометрия — из
// status-screen.tsx. Поменяются там — поменять и здесь, автоматической связи нет.
//
// Стили — тегом <style>, а не инлайном: только так экран уважает тёмную тему
// (prefers-color-scheme) и prefers-reduced-motion. Инлайн-стиль медиазапросом не выключить,
// а отдавать тёмному пользователю белую вспышку во весь экран — плохой финал падения.
const STYLES = `
  /* Токены — значениями из globals.css: :root для светлой темы, .dark для тёмной.
     Берём только то, что нужно этому экрану. */
  :root { color-scheme: light dark;
          --ge-bg: oklch(1 0 0); --ge-fg: oklch(0.145 0 0);
          --ge-muted: oklch(0.967 0.003 264.5); --ge-muted-fg: oklch(0.545 0.023 264.4);
          --ge-primary: oklch(0.546 0.215 262.9); --ge-on-primary: oklch(1 0 0);
          --ge-border: oklch(0.928 0.006 264.5); }
  @media (prefers-color-scheme: dark) {
    :root { --ge-bg: oklch(0.177 0.009 264.3); --ge-fg: oklch(0.967 0.003 264.5);
            --ge-muted: oklch(0.261 0.024 267.1); --ge-muted-fg: oklch(0.714 0.019 261.3);
            --ge-primary: oklch(0.573 0.188 259.8); --ge-on-primary: oklch(1 0 0);
            --ge-border: oklch(0.311 0.022 259.4); }
  }

  /* Панель во весь экран на фоне bg-muted/30 — как у StatusScreen, а не карточка. */
  body { margin:0; min-height:100dvh; display:flex; flex-direction:column; position:relative;
         overflow:hidden; background:color-mix(in oklch, var(--ge-muted) 30%, var(--ge-bg));
         color:var(--ge-fg); font:400 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }

  /* Декоративная подложка: сетка точек и мягкое свечение брендовым тоном (.status-backdrop). */
  .ge-backdrop { position:absolute; inset:0; pointer-events:none; }
  .ge-backdrop::before { content:''; position:absolute; inset:0; opacity:.05;
    background-image:radial-gradient(circle at 1px 1px, var(--ge-fg) 1px, transparent 0);
    background-size:28px 28px;
    -webkit-mask-image:radial-gradient(70% 60% at 50% 42%, #000 0%, transparent 100%);
    mask-image:radial-gradient(70% 60% at 50% 42%, #000 0%, transparent 100%); }
  .ge-backdrop::after { content:''; position:absolute; inset:0; opacity:.09;
    background:radial-gradient(64% 48% at 50% 22%, var(--ge-primary), transparent 70%); }

  /* Подпись продукта в углу: иконка 1.5rem, текст 1.125rem/700 — как в ProductSwitcher. */
  .ge-brand { position:relative; display:flex; align-items:center; gap:.5rem;
              padding:1.5rem 1.5rem 0; font-size:1.125rem; font-weight:700;
              letter-spacing:-.01em; }
  .ge-brand svg { width:1.5rem; height:1.5rem; flex:none; color:var(--ge-primary); }

  .ge-in { position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column;
           align-items:center; justify-content:center; gap:1.5rem; padding:2.5rem 1.5rem;
           text-align:center; }

  /* Иконка в ореоле из концентрических колец: 11rem → 7rem → 5rem. */
  .ge-icon { position:relative; display:flex; align-items:center; justify-content:center; }
  .ge-halo, .ge-ring { position:absolute; border-radius:9999px; }
  .ge-halo { width:11rem; height:11rem; background:color-mix(in oklch, var(--ge-primary) 7%, transparent);
             animation:ge-halo 4s ease-in-out infinite; }
  .ge-ring { width:7rem; height:7rem; background:color-mix(in oklch, var(--ge-primary) 10%, transparent); }
  .ge-chip { position:relative; display:flex; align-items:center; justify-content:center;
             width:5rem; height:5rem; border-radius:1rem; color:var(--ge-primary);
             background:color-mix(in oklch, var(--ge-primary) 15%, transparent);
             box-shadow:inset 0 0 0 1px color-mix(in oklch, var(--ge-primary) 20%, transparent); }
  .ge-chip svg { width:2.5rem; height:2.5rem; }

  .ge-copy { display:flex; max-width:28rem; flex-direction:column; align-items:center; gap:.5rem; }
  .ge-title { margin:0; font-size:1.5rem; font-weight:600; letter-spacing:-.01em;
              text-wrap:balance; }
  .ge-text { margin:0; color:var(--ge-muted-fg); line-height:1.625; text-wrap:pretty; }

  /* Код происшествия: его называют в поддержке, поэтому выделяется целиком по клику. */
  .ge-code { display:inline-flex; max-width:100%; align-items:center; gap:.375rem; margin:0;
             padding:.25rem .5rem; border-radius:.625rem; background:var(--ge-muted);
             color:var(--ge-muted-fg); font-size:.75rem; }
  .ge-code code { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
                  color:color-mix(in oklch, var(--ge-fg) 80%, transparent); user-select:all;
                  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }

  .ge-actions { display:flex; width:100%; max-width:24rem; flex-direction:column; gap:.5rem; }
  @media (min-width:640px) { .ge-actions { width:auto; flex-direction:row; justify-content:center; } }
  /* Кнопка: h-10, px-4, gap-2, rounded-xl, text-sm/500 — как Button size="lg". */
  .ge-btn { display:inline-flex; align-items:center; justify-content:center; gap:.5rem;
            height:2.5rem; padding:0 1rem; border:0; border-radius:.875rem; cursor:pointer;
            font-family:inherit; font-size:14px; font-weight:500; line-height:1;
            text-decoration:none; transition:background-color .15s, box-shadow .15s; }
  .ge-btn svg { width:1rem; height:1rem; flex:none; }
  .ge-btn:active { transform:translateY(1px); }
  .ge-btn-primary { background:var(--ge-primary); color:var(--ge-on-primary); }
  .ge-btn-primary:hover { background:color-mix(in oklch, var(--ge-primary) 90%, transparent); }
  .ge-btn-ghost { background:var(--ge-bg); color:var(--ge-fg);
                  box-shadow:inset 0 0 0 1px var(--ge-border); }
  .ge-btn-ghost:hover { background:var(--ge-muted); }

  @keyframes ge-halo { 0%,100% { transform:scale(1); opacity:.9 } 50% { transform:scale(1.08); opacity:.5 } }
  @keyframes ge-in { from { opacity:0; transform:translateY(10px) } to { opacity:1 } }
  .ge-in { animation:ge-in .45s cubic-bezier(.22,1,.36,1); }
  @media (prefers-reduced-motion:reduce) {
    .ge-in { animation:none } .ge-halo { animation:none }
  }
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

        {/* Сетка точек и свечение — как у StatusScreen (.status-backdrop). */}
        <div className="ge-backdrop" aria-hidden />

        {/* Подпись продукта в углу. На этом экране оболочки нет и свериться не с чем:
            без неё страница читается как чужая, а не как та же система. */}
        <div className="ge-brand">
          {/* Иконки lucide тянуть нельзя по той же причине, что и стили: пакет грузит
              тот же упавший бандл. Фигуры рисуем руками — те же, что в lucide. */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M22 10 12 5 2 10l10 5 10-5Z" strokeLinejoin="round" />
            <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" strokeLinecap="round" />
          </svg>
          StudentHub
        </div>

        <main className="ge-in">
          {/* Иконка в ореоле из концентрических колец: на пустой панели одиночная
              плашка терялась, а кольца задают центр композиции. */}
          <div className="ge-icon">
            <span className="ge-halo" aria-hidden />
            <span className="ge-ring" aria-hidden />
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

          <div className="ge-copy">
            <h1 className="ge-title">Что-то пошло не так</h1>
            <p className="ge-text">
              Мы записали сбой и уже разбираемся. Чаще всего помогает повторить.
            </p>
          </div>

          {/* Код происшествия — единственная ниточка между тем, что человек видел, и
              записью в Sentry. Без неё обращение звучит как «у меня всё сломалось». */}
          {error.digest && (
            <p className="ge-code">
              <span>Код ошибки</span>
              <code>{error.digest}</code>
            </p>
          )}

          <div className="ge-actions">
            <button type="button" className="ge-btn ge-btn-primary" onClick={reset}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" />
                <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Попробовать снова
            </button>
            <a href="/" className="ge-btn ge-btn-ghost">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" strokeLinejoin="round" />
                <path d="M9 22V12h6v10" strokeLinejoin="round" />
              </svg>
              На главную
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
