'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { GraduationCap } from 'lucide-react'
import { LEGAL_ROUTES, type LegalDoc } from '../../../shared/config/routes'

interface LegalSection {
  heading: string
  body: string
}

/**
 * Полная страница юридического документа — политики конфиденциальности или
 * пользовательского соглашения.
 *
 * Раньше оба лежали в модальном окне на экране входа. У документа, который требуется
 * показать до регистрации, обязан быть собственный адрес: его шлют ссылкой, кладут в
 * письмо и в договор с вузом, на него ссылаются магазины приложений. Модалка такой
 * ссылки не даёт — открыть её можно только изнутри формы входа.
 *
 * Страница публичная (middleware, LEGAL_BASE) и доступна в обе стороны: и человеку без
 * аккаунта, и вошедшему. Вошедшего отсюда не уводят на его домашнюю страницу — иначе
 * ссылка на документ работала бы только у тех, кто не в системе.
 */
export function LegalDocumentView({ doc }: { doc: LegalDoc }) {
  const t = useTranslations('Legal')

  // Ключи заданы статически (по одному на документ) — сборка вида t(`${doc}.title`)
  // запрещена правилами i18n. `raw` нужен, чтобы получить массив разделов как есть.
  const content =
    doc === 'privacy'
      ? {
          title: t('privacy.title'),
          intro: t('privacy.intro'),
          sections: t.raw('privacy.sections') as LegalSection[],
        }
      : {
          title: t('terms.title'),
          intro: t('terms.intro'),
          sections: t.raw('terms.sections') as LegalSection[],
        }
  // Перекрёстная ссылка: документы читают парой, и возвращаться ради второго на экран
  // входа незачем.
  const other =
    doc === 'privacy'
      ? { href: LEGAL_ROUTES.terms, label: t('termsLink') }
      : { href: LEGAL_ROUTES.privacy, label: t('privacyLink') }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Шапка — не «назад», а выход в приложение: страницу открывают в отдельной вкладке
          и по прямой ссылке из письма, где возвращаться браузеру некуда. С корня
          middleware уводит куда нужно: вошедшего домой, остальных на вход. */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-4 sm:h-16">
          <Link
            href="/"
            className="-ml-2 flex items-center gap-2 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <GraduationCap className="size-5 shrink-0 text-primary" aria-hidden />
            {/* Название продукта, а не переводимая строка: оно одинаково во всех локалях. */}
            <span className="font-semibold tracking-tight">StudentHub</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-10">
        <article className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{content.title}</h1>
            <p className="text-xs text-muted-foreground">{t('updated')}</p>
          </header>

          <p className="text-sm leading-relaxed text-muted-foreground">{content.intro}</p>

          <div className="flex flex-col gap-5">
            {content.sections.map((section) => (
              <section key={section.heading} className="flex flex-col gap-1.5">
                <h2 className="font-semibold">{section.heading}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{section.body}</p>
              </section>
            ))}
          </div>
        </article>

        <footer className="mt-10 border-t border-border pt-6">
          <Link
            href={other.href}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {other.label}
          </Link>
        </footer>
      </main>
    </div>
  )
}
