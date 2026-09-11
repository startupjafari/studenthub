'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, GraduationCap, Home, RotateCcw, type LucideIcon } from 'lucide-react'
import { Button, buttonVariants } from './button'
import { cn } from '../lib/utils'

export interface StatusScreenProps {
  // HTTP-код (403/404/…). Необязателен — для error-boundary показываем только иконку.
  code?: string
  title: string
  description?: string
  icon: LucideIcon
  showHome?: boolean
  showBack?: boolean
  onRetry?: () => void
  /**
   * Техническая метка происшествия (digest ошибки) — её называют в поддержке. Отдельно от
   * `description`: то объясняет человеку, что случилось, а это нужно тому, кто будет чинить.
   */
  detail?: { label: string; value: string }
  /** Доп. путь вместо тупика: напр. «ввести код помещения вручную» на экране «QR не найден». */
  action?: { href: string; label: string; icon?: LucideIcon }
}

// Единый системный экран статуса (403/404/offline/ошибка): подложка приложения, карточка
// уровня контента и иконка-плашка — те же поверхности, что на обычных страницах
// (DESIGN_SYSTEM §5.2). Экран рендерится вне оболочки приложения, поэтому над карточкой
// стоит подпись продукта, а под ней — фирменная точечная сетка со свечением: без неё
// в тёмной теме подложка `bg-muted/30` и `bg-card` почти совпадают, и карточка не читалась
// как отдельная поверхность.
//
// Крупный код — единственное исключение по кеглю (§3: `text-3xl`+ только здесь). Он стоит
// в паре с иконкой в тонированной шапке карточки: «404» отвечает, что произошло, быстрее
// любого заголовка, и заслуживает быть первым, а не мелкой серой строкой над ним.
export function StatusScreen({
  code,
  title,
  description,
  icon: Icon,
  showHome = true,
  showBack = false,
  onRetry,
  detail,
  action,
}: StatusScreenProps) {
  const t = useTranslations('Common')
  const router = useRouter()

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden bg-muted/30 p-6">
      {/* Декоративная подложка: сетка точек и мягкое свечение брендовым тоном.
          Оба слоя — псевдоэлементы класса из globals.css, чтобы гасить их медиазапросами
          (reduced-transparency / contrast: more), а не условием в React. */}
      <div className="status-backdrop pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative flex items-center gap-2">
        <GraduationCap className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-foreground/80">StudentHub</span>
      </div>

      <div className="status-in relative w-full max-w-md overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {/* Шапка карточки: иконка и код на тонированной подложке. */}
        <div className="flex items-center justify-center gap-4 border-b border-border bg-primary/5 px-6 py-6">
          {/* Иллюстративная иконка в скруглённом квадрате — идиома системы (§6). */}
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-8" aria-hidden />
          </span>
          {code && (
            // Одиночное крупное число — пропорциональными цифрами (§3), не tabular.
            <span className="text-4xl leading-none font-bold tracking-tight text-primary">
              {code}
            </span>
          )}
        </div>

        <div className="px-6 py-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}

          {detail && (
            <p className="mt-4 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
              <span className="shrink-0">{detail.label}</span>
              {/* Значение выделяемое: его копируют в обращение в поддержку. */}
              <code className="min-w-0 truncate font-mono text-foreground/80 select-all">
                {detail.value}
              </code>
            </p>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {onRetry && (
              <Button onClick={onRetry}>
                <RotateCcw className="size-4" aria-hidden />
                {t('retry')}
              </Button>
            )}
            {showHome && (
              <Link
                href="/"
                className={cn(buttonVariants({ variant: onRetry ? 'outline' : 'default' }))}
              >
                <Home className="size-4" aria-hidden />
                {t('goHome')}
              </Link>
            )}
            {showBack && (
              <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="size-4" aria-hidden />
                {t('goBack')}
              </Button>
            )}
            {action && (
              <Link href={action.href} className={cn(buttonVariants({ variant: 'outline' }))}>
                {action.icon && <action.icon className="size-4" aria-hidden />}
                {action.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
