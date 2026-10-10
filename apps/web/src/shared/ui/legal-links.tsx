'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { LEGAL_ROUTES } from '../config/routes'
import { cn } from '../lib/utils'

export interface LegalLinksProps {
  className?: string
}

/**
 * Неприметная пара ссылок «Политика конфиденциальности · Пользовательское соглашение»
 * под формами входа и заявки вуза.
 *
 * Документы живут отдельными страницами (`/legal/...`), а не в модальном окне: у того,
 * что требуется показать до регистрации, обязан быть собственный адрес — его шлют
 * ссылкой и кладут в письмо.
 *
 * Открываются в новой вкладке. Формы под ними длинные (заявка вуза — дюжина полей), а
 * документ читают, не отрываясь от заполнения: уход на страницу в той же вкладке стёр
 * бы всё набранное, и возврат «назад» его не вернул бы.
 */
export function LegalLinks({ className }: LegalLinksProps) {
  const t = useTranslations('Legal')

  return (
    // Узкий экран — две строки по центру; с sm обе ссылки влезают в строку и между ними
    // появляется разделитель. Иначе точка повисает в конце первой строки.
    <p
      className={cn(
        'flex flex-col items-center justify-center gap-1 text-center sm:flex-row sm:gap-2',
        className,
      )}
    >
      <LegalLink href={LEGAL_ROUTES.privacy} label={t('privacyLink')} />
      <span className="hidden text-xs text-muted-foreground/50 sm:inline" aria-hidden>
        ·
      </span>
      <LegalLink href={LEGAL_ROUTES.terms} label={t('termsLink')} />
    </p>
  )
}

function LegalLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Строка в 16px — цель нажатия вдвое меньше минимума WCAG 2.5.8 (24×24). Растим
      // отступами до 28px; отрицательный вертикальный гасит половину прибавки, чтобы
      // подвал форм входа не подрос.
      className="-my-1 rounded px-2 py-1.5 text-xs text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {label}
    </Link>
  )
}
