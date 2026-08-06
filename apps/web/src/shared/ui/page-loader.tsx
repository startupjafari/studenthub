import { Loader2 } from 'lucide-react'
import { cn } from '../lib'

export interface PageLoaderProps {
  /** Текст под спиннером. */
  label: string
  /** Класс обёртки — задаёт высоту зоны центрирования (по умолчанию на всю высоту родителя). */
  className?: string
}

// Центрированный лоадер страницы: спиннер над текстом, по центру вертикали и горизонтали.
export function PageLoader({ label, className }: PageLoaderProps) {
  return (
    <div
      className={cn(
        'flex min-h-full flex-col items-center justify-center gap-3 text-foreground/60',
        className,
      )}
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
