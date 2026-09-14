import type { CSSProperties, ReactNode } from 'react'

/**
 * Маленький набор общих кирпичей лендинга.
 *
 * Полноценная дизайн-система живёт в платформе (apps/web/src/shared/ui) и сюда не
 * импортируется — лендинг изолирован. Здесь ровно то, что нужно одной странице.
 *
 * Ритм задаётся здесь и только здесь: одна ширина контейнера, один вертикальный отступ
 * полосы, одна лестница заголовков. Секция, которая «чуть-чуть по-своему», ломает
 * выравнивание всей страницы — поэтому своих отступов у секций нет.
 */

/**
 * Одна ширина контента на весь сайт. Поля растут вместе с окном, но не бесконечно.
 *
 * 96rem (≈1536 px): на широких мониторах узкая колонка оставляла по трети экрана пустыми
 * с каждой стороны, и страница читалась как мобильная версия, растянутая в центре. Поля
 * при этом сжимаются до 1rem на 320 px — там каждый пиксель ширины на счету.
 */
export function Container({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mx-auto w-full max-w-[96rem] px-[clamp(1rem,4vw,4rem)] ${className}`}>
      {children}
    </div>
  )
}

/**
 * Полоса страницы. Вертикальный отступ один на все секции — он и создаёт ритм, по
 * которому страница читается как целое, а не как склейка блоков.
 */
export function Section({
  id,
  children,
  className = '',
}: {
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`scroll-mt-24 py-[clamp(4rem,9vw,8.25rem)] ${className}`}>
      <Container className="flex flex-col gap-[clamp(2.5rem,4vw,4rem)]">{children}</Container>
    </section>
  )
}

/**
 * Блок, который появляется при прокрутке.
 *
 * Само появление включает `SiteMotion` — один наблюдатель на всю страницу. `delay` задаёт
 * место в каскаде группы (0, 1, 2…), а не миллисекунды: шаг общий для сайта, и подбирать
 * его в каждой секции заново нельзя, иначе блоки всплывают вразнобой.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
  style,
}: {
  children: ReactNode
  delay?: number
  as?: 'div' | 'li' | 'section'
  className?: string
  style?: CSSProperties
}) {
  return (
    <Tag data-reveal className={className} style={{ '--d': delay, ...style } as CSSProperties}>
      {children}
    </Tag>
  )
}

/**
 * Заголовок секции. Лендинг — единственная поверхность бренда, которую читают, а не в
 * которой работают, поэтому кегль здесь крупнее продуктового (docs/DESIGN_SYSTEM.md §1.2
 * про плотность написан для рабочих экранов).
 */
export function SectionHeading({
  title,
  subtitle,
  align = 'start',
}: {
  title: string
  subtitle?: string
  align?: 'start' | 'center'
}) {
  const alignment = align === 'center' ? 'items-center text-center' : 'items-start'
  return (
    <Reveal className={`flex flex-col gap-3 ${alignment}`}>
      <h2 className="text-[clamp(1.65rem,3vw,2.5rem)] leading-[1.12] font-semibold tracking-tight text-balance">
        {title}
      </h2>
      {/* `foreground/70`, а не `muted-foreground`: приглушённый токен рассчитан на мелкие
          подписи в плотном интерфейсе, а здесь это абзац, который читают целиком. */}
      {subtitle && (
        <p className="max-w-[52ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-relaxed text-foreground/70">
          {subtitle}
        </p>
      )}
    </Reveal>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

/*
  Кнопки повторяют язык платформы (apps/web/src/shared/ui/button.tsx): скругление `xl`,
  широкое мягкое кольцо фокуса вместо тонкой обводки, нажатие сдвигает на пиксель.
  Лендинг и продукт — одно целое, и кнопка это первое, что их выдаёт.
*/
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-border bg-card text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
  className = '',
  external = false,
}: {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  className?: string
  /** Ссылка ведёт на другой домен (платформа, почта) — обычный <a>, не next/link. */
  external?: boolean
}) {
  return (
    <a
      href={href}
      // rel без noopener был бы дырой: страница-получатель получает window.opener.
      {...(external ? { rel: 'noopener' } : {})}
      className={[
        'sh-press inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-medium whitespace-nowrap',
        'outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/20',
        BUTTON_STYLES[variant],
        className,
      ].join(' ')}
    >
      {children}
    </a>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </span>
  )
}
