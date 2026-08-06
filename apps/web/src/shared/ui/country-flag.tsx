import { cn } from '../lib/utils'

// Флаг страны через flag-icons (SVG всех стран, локально в бандле — offline-safe).
// code — ISO 3166-1 alpha-2 (регистр не важен). CSS подключён в globals.css.
export function CountryFlag({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        'fi inline-block h-3.5 w-5 shrink-0 rounded-[3px] bg-cover bg-center ring-1 ring-black/10',
        `fi-${code.toLowerCase()}`,
        className,
      )}
      aria-hidden
    />
  )
}
