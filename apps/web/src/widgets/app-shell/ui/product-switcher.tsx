'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'
import { Briefcase, Check, GraduationCap } from 'lucide-react'
import { cn } from '../../../shared/lib/utils'

/** Корень карьерного продукта. Всё, что под ним, считается «Карьерой». */
const CAREER_ROOT = '/career'

/**
 * Переключатель продуктов под логотипом: «StudentHub» (учёба) и «StudentHub Карьера».
 *
 * Отдельным пунктом навигации сознательно не является: Карьера — не раздел платформы,
 * а второй продукт со своим набором разделов, и смешивать его с «Лентой» и «Расписанием»
 * в одном списке значило бы соврать про структуру.
 *
 * Radix HoverCard, а не DropdownMenu: раскрывается по наведению, сам держит задержки и
 * «безопасный коридор» к карточке, а по фокусу с клавиатуры открывается так же — ссылки
 * внутри доступны Tab'ом. Клик по логотипу тоже открывает карточку: на тач-экране
 * наведения нет.
 */
export function ProductSwitcher({ homeHref }: { homeHref: string }) {
  const t = useTranslations('Products')
  const pathname = usePathname()
  const onCareer = pathname === CAREER_ROOT || pathname.startsWith(`${CAREER_ROOT}/`)

  return (
    <HoverCardPrimitive.Root openDelay={120} closeDelay={160}>
      <HoverCardPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('switch')}
          className="-ml-1.5 flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left whitespace-nowrap outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <GraduationCap className="size-6 shrink-0 text-primary" aria-hidden />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-bold">StudentHub</span>
            {onCareer && (
              <span className="mt-0.5 text-[0.6875rem] font-semibold tracking-wide text-primary uppercase">
                {t('career.short')}
              </span>
            )}
          </span>
        </button>
      </HoverCardPrimitive.Trigger>

      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          align="start"
          sideOffset={8}
          className="z-[200] w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <ProductLink
            href={homeHref}
            icon={GraduationCap}
            title="StudentHub"
            subtitle={t('main.hint')}
            active={!onCareer}
          />
          <ProductLink
            href={CAREER_ROOT}
            icon={Briefcase}
            title={t('career.title')}
            subtitle={t('career.hint')}
            active={onCareer}
          />
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  )
}

function ProductLink({
  href,
  icon: Icon,
  title,
  subtitle,
  active,
}: {
  href: string
  icon: typeof GraduationCap
  title: string
  subtitle: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex items-start gap-3 rounded-lg px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30',
        active ? 'bg-muted' : 'hover:bg-muted/60',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="text-xs leading-snug text-muted-foreground">{subtitle}</span>
      </span>
      {active && <Check className="mt-1.5 size-4 shrink-0 text-primary" aria-hidden />}
    </Link>
  )
}
