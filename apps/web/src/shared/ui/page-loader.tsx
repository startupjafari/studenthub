import { cn } from '../lib'

export interface PageLoaderProps {
  /** Текст под спиннером. */
  label: string
  /** Класс обёртки — задаёт высоту зоны центрирования (по умолчанию на всю высоту родителя). */
  className?: string
}

// Центрированный лоадер страницы: кольцо над подписью, по центру вертикали и горизонтали.
//
// Спиннер собран из двух окружностей, а не взят иконкой lucide: у `Loader2` дуга обрублена
// под углом и «худеет» на изгибе — на пустом экране, где смотреть больше не на что, это
// читается как кривая деталь. Здесь геометрия ровная: неподвижный след постоянной толщины
// плюс четверть дуги с круглыми концами поверх него. Вращается весь svg, но след
// симметричен, поэтому глаз видит одну едущую дугу в идеально круглом кольце.
export function PageLoader({ label, className }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-full flex-col items-center justify-center gap-3 animate-in fade-in-0 duration-300',
        className,
      )}
    >
      <svg viewBox="0 0 28 28" className="size-7 animate-spin" fill="none" aria-hidden>
        <circle
          cx="14"
          cy="14"
          r="12.5"
          className="text-foreground/10"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M14 1.5A12.5 12.5 0 0 1 26.5 14"
          className="text-primary"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}
