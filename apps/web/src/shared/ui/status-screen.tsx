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
  /** Доп. путь вместо тупика: напр. «ввести код помещения вручную» на экране «QR не найден». */
  action?: { href: string; label: string; icon?: LucideIcon }
}

// Единый системный экран статуса (403/404/ошибка): подложка приложения, карточка уровня
// контента и иконка-плашка — те же поверхности, что на обычных страницах (DESIGN_SYSTEM §5.2).
// Экран рендерится вне оболочки приложения, поэтому над карточкой стоит подпись продукта.
// Крупный код — единственное исключение по кеглю (§4: `text-3xl`+ только здесь).
// API стабилен для Forbidden/not-found/error.
export function StatusScreen({
  code,
  title,
  description,
  icon: Icon,
  showHome = true,
  showBack = false,
  onRetry,
  action,
}: StatusScreenProps) {
  const t = useTranslations('Common')
  const router = useRouter()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/30 p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-foreground/80">StudentHub</span>
      </div>

      <div className="status-in w-full max-w-md rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10 sm:p-10">
        {/* Иллюстративная иконка в скруглённом квадрате — идиома системы (§6). */}
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </div>

        {code && (
          <p className="mt-5 text-3xl font-bold tracking-tight text-muted-foreground tabular-nums">
            {code}
          </p>
        )}
        <h1 className={cn('text-base font-semibold text-foreground', code ? 'mt-1' : 'mt-5')}>
          {title}
        </h1>
        {description && (
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {description}
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
  )
}
