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

// Единый системный экран статуса (403/404/ошибка): декоративный фон (свечение + точки),
// «стеклянная» карточка с градиентным акцентом, крупный градиентный код и действия.
// Синяя палитра, тёмная тема — через токены. API стабилен для Forbidden/not-found/error.
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Декоративный фон: тёплое свечение по центру, мягкая точечная сетка, виньетка. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 size-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px] opacity-60 [mask-image:radial-gradient(ellipse_55%_55%_at_center,#000_10%,transparent_75%)]" />
      </div>

      <div
        className="relative z-10 w-full max-w-md"
        style={{ animation: 'status-in 0.45s cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div className="mb-7 flex items-center justify-center gap-2">
          <GraduationCap className="size-5 text-primary" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-foreground/80">
            StudentHub
          </span>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-border bg-background/70 p-8 text-center backdrop-blur-xl sm:p-10">
          {/* Верхний градиентный акцент. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
          />

          {/* Иконка со свечением. */}
          <div className="relative mx-auto mb-7 flex size-20 items-center justify-center">
            <div aria-hidden className="absolute inset-2 rounded-2xl bg-primary/20 blur-xl" />
            <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/15 to-primary/5 text-primary">
              <Icon className="size-8" aria-hidden />
            </div>
          </div>

          {code && (
            <p className="bg-gradient-to-b from-primary to-primary/55 bg-clip-text text-7xl font-black tracking-tighter text-transparent tabular-nums sm:text-8xl">
              {code}
            </p>
          )}
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}

          <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {onRetry && (
              <Button onClick={onRetry} className="gap-2">
                <RotateCcw className="size-4" aria-hidden />
                {t('retry')}
              </Button>
            )}
            {showHome && (
              <Link
                href="/"
                className={cn(
                  buttonVariants({ variant: onRetry ? 'outline' : 'default' }),
                  'gap-2',
                )}
              >
                <Home className="size-4" aria-hidden />
                {t('goHome')}
              </Link>
            )}
            {showBack && (
              <Button variant="outline" onClick={() => router.back()} className="gap-2">
                <ArrowLeft className="size-4" aria-hidden />
                {t('goBack')}
              </Button>
            )}
            {action && (
              <Link
                href={action.href}
                className={cn(buttonVariants({ variant: 'outline' }), 'gap-2')}
              >
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
