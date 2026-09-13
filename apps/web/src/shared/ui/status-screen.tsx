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

// Единый системный экран статуса (403/404/offline/ошибка). Занимает всё отведённое место
// целиком — одной панелью во всю ширину и высоту, без карточки-визитки посреди пустоты.
//
// Высоту экран берёт у места, где отрисован, а не у окна (класс `.status-screen`,
// globals.css): самостоятельной страницей — высота окна, внутри оболочки приложения —
// свободная высота `main`. Раньше здесь стоял `min-h-dvh`, и внутри оболочки экран
// оказывался выше доступной области ровно на её отступы — появлялась лишняя прокрутка.
//
// Подпись продукта нужна только вне оболочки: рядом с сайдбаром она дублировала бы
// логотип в шапке. Прячет её тот же CSS-хук.
//
// Крупный код — единственное исключение по кеглю (§3: `text-3xl`+ только здесь). Он
// отвечает, что произошло, быстрее любого заголовка, и потому стоит первым.
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
    <div className="status-screen relative flex w-full flex-1 flex-col overflow-hidden bg-muted/30">
      {/* Декоративная подложка: сетка точек и мягкое свечение брендовым тоном.
          Оба слоя — псевдоэлементы класса из globals.css, чтобы гасить их медиазапросами
          (reduced-transparency / contrast: more), а не условием в React. */}
      <div className="status-backdrop pointer-events-none absolute inset-0" aria-hidden />

      <div className="status-brand relative flex items-center gap-2 px-6 pt-6">
        <GraduationCap className="size-5 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-foreground/80">StudentHub</span>
      </div>

      {/* Содержимое по центру свободного места: панель растянута, а читаемая колонка
          остаётся узкой — строка во всю ширину монитора не читается. */}
      <div className="status-in relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        {/* Иконка в ореоле из концентрических колец: на пустой панели одиночная плашка
            терялась, а кольца задают центр композиции. */}
        <div className="relative flex items-center justify-center">
          <span
            className="status-halo absolute size-44 rounded-full bg-primary/[0.07]"
            aria-hidden
          />
          <span className="absolute size-28 rounded-full bg-primary/10" aria-hidden />
          <span className="relative flex size-20 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
            <Icon className="size-10" aria-hidden />
          </span>
        </div>

        {code && (
          // Одиночное крупное число — пропорциональными цифрами (§3), не tabular.
          <span className="bg-gradient-to-b from-primary to-primary/45 bg-clip-text text-6xl leading-none font-bold tracking-tight text-transparent sm:text-7xl">
            {code}
          </span>
        )}

        <div className="flex max-w-md flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground">
            {title}
          </h1>
          {description && (
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {detail && (
          <p className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
            <span className="shrink-0">{detail.label}</span>
            {/* Значение выделяемое: его копируют в обращение в поддержку. */}
            <code className="min-w-0 truncate font-mono text-foreground/80 select-all">
              {detail.value}
            </code>
          </p>
        )}

        <div className="flex w-full max-w-sm flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
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
