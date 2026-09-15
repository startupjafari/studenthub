import type { CSSProperties, ReactNode } from 'react'
import { Reveal, TapLink } from './motion'

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
 * Одна ширина контента на весь сайт.
 *
 * 78rem (≈1248 px). Раньше здесь было 96rem: тогда лендинг держал плотные блоки, и узкая
 * колонка оставляла по трети экрана пустыми с каждой стороны. Теперь несущий приём —
 * воздух, и на 96rem строки заголовков расползались настолько, что взгляд терял начало
 * следующей. 78rem держит абзац в районе 70 знаков и оставляет полям работу.
 *
 * Поля сжимаются до 1.25rem на 320 px — там каждый пиксель ширины на счету.
 */
export function Container({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mx-auto w-full max-w-[78rem] px-[clamp(1.25rem,4vw,2.5rem)] ${className}`}>
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
    <section id={id} className={`scroll-mt-24 py-[clamp(5rem,9vw,9rem)] ${className}`}>
      <Container className="flex flex-col gap-[clamp(2.75rem,4vw,4.25rem)]">{children}</Container>
    </section>
  )
}

export { Reveal }

/**
 * Заголовок секции.
 *
 * Лендинг — единственная поверхность бренда, которую читают, а не в которой работают,
 * поэтому кегль здесь крупнее продуктового (docs/DESIGN_SYSTEM.md §1.2 про плотность
 * написан для рабочих экранов).
 *
 * Дисплейная гарнитура и плотный трекинг — на заголовке, но не на абзаце: Onest на кегле
 * основного текста начинает спорить с Inter, а не дополнять его.
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
    <Reveal className={`flex flex-col gap-4 ${alignment}`}>
      <h2 className="sh-title font-display text-[clamp(1.75rem,3.4vw,2.9rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-balance">
        {title}
      </h2>
      {/* `foreground/70`, а не `muted-foreground`: приглушённый токен рассчитан на мелкие
          подписи в плотном интерфейсе, а здесь это абзац, который читают целиком. */}
      {subtitle && (
        <p className="max-w-[54ch] text-[clamp(0.975rem,1.3vw,1.1rem)] leading-relaxed text-foreground/70">
          {subtitle}
        </p>
      )}
    </Reveal>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'md' | 'sm'

/*
  Кнопки повторяют язык платформы (apps/web/src/shared/ui/button.tsx), но крупнее:
  на лендинге это главная цель для пальца, а не элемент плотной панели. Высота 3rem —
  48 px, выше порога в 44 px, который держит попадание без прицеливания.

  Нажатие даёт Framer Motion (TapLink), а не CSS: отклик один и тот же и у кнопки,
  и у карточки, и задаётся он в motion.tsx.
*/
/*
  Размер — свойство, а не класс в `className`. Утилиты одного семейства Tailwind
  раскладывает в CSS по значению, а не по порядку в строке: `h-10` попадает в файл
  раньше `h-12`, и «переопределение» высоты снаружи молча проигрывало базовому классу.
*/
const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: 'h-12 px-6 text-[0.9375rem]',
  sm: 'h-10 px-4 text-[0.8125rem]',
}

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'sh-glow bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-hairline bg-surface text-foreground hover:bg-surface-strong',
  ghost: 'text-foreground hover:bg-surface',
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  external = false,
}: {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  /** Ссылка ведёт на другой домен (платформа, почта) — обычный <a>, не next/link. */
  external?: boolean
}) {
  return (
    <TapLink
      href={href}
      external={external}
      className={[
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl font-medium whitespace-nowrap',
        'outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/25',
        BUTTON_SIZES[size],
        BUTTON_STYLES[variant],
        className,
      ].join(' ')}
    >
      {children}
    </TapLink>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[0.6875rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
      {children}
    </span>
  )
}

/**
 * Плашка-подпись: статус, тег, ярлык. Одна форма на весь сайт — иначе каждый раздел
 * заводит свой скруглённый прямоугольник, и страница рассыпается на диалекты.
 */
export function Chip({
  children,
  tone = 'plain',
  className = '',
  style,
}: {
  children: ReactNode
  tone?: 'plain' | 'accent'
  className?: string
  style?: CSSProperties
}) {
  const tones = {
    plain: 'border-hairline bg-surface text-muted-foreground',
    accent: 'border-primary/30 bg-primary/10 text-primary',
  }
  return (
    <span
      style={style}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
