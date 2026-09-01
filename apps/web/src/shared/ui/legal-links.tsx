'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '../lib/utils'
import { Modal } from './modal'

type LegalDoc = 'privacy' | 'terms'

interface LegalSection {
  heading: string
  body: string
}

export interface LegalLinksProps {
  className?: string
}

/**
 * Неприметная пара ссылок «Политика конфиденциальности · Пользовательское соглашение»
 * с текстом документа в модальном окне.
 *
 * Отдельных страниц у документов нет намеренно: платформа закрытая, читают их с экрана
 * входа, и уводить с формы ради двух абзацев смысла нет.
 */
export function LegalLinks({ className }: LegalLinksProps) {
  const t = useTranslations('Legal')
  const [doc, setDoc] = useState<LegalDoc | null>(null)

  // Ключи заданы статически (по одному на документ) — сборка вида t(`${doc}.title`)
  // запрещена правилами i18n. `raw` нужен, чтобы получить массив разделов как есть.
  const content =
    doc === 'privacy'
      ? {
          title: t('privacy.title'),
          intro: t('privacy.intro'),
          sections: t.raw('privacy.sections'),
        }
      : doc === 'terms'
        ? { title: t('terms.title'), intro: t('terms.intro'), sections: t.raw('terms.sections') }
        : null

  return (
    <>
      {/* Узкий экран — две строки по центру; с sm обе ссылки влезают в строку и между ними
          появляется разделитель. Иначе точка повисает в конце первой строки. */}
      <p
        className={cn(
          'flex flex-col items-center justify-center gap-1 text-center sm:flex-row sm:gap-2',
          className,
        )}
      >
        <LegalLink label={t('privacyLink')} onClick={() => setDoc('privacy')} />
        <span className="hidden text-xs text-muted-foreground/50 sm:inline" aria-hidden>
          ·
        </span>
        <LegalLink label={t('termsLink')} onClick={() => setDoc('terms')} />
      </p>

      {content && (
        <Modal onClose={() => setDoc(null)} title={content.title} size="xl">
          <div className="flex flex-col gap-5 text-sm leading-relaxed">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">{t('updated')}</p>
              <p className="text-muted-foreground">{content.intro}</p>
            </div>
            {(content.sections as LegalSection[]).map((section) => (
              <section key={section.heading} className="flex flex-col gap-1.5">
                <h3 className="font-semibold">{section.heading}</h3>
                <p className="text-muted-foreground">{section.body}</p>
              </section>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}

function LegalLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Строка в 16px — цель нажатия вдвое меньше минимума WCAG 2.5.8 (24×24). Растим
      // отступами до 28px; отрицательный вертикальный гасит половину прибавки, чтобы
      // подвал форм входа не подрос.
      className="-my-1 cursor-pointer rounded px-2 py-1.5 text-xs text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {label}
    </button>
  )
}
