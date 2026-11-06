// Стили флагов — здесь, а не в globals.css (задача 21.B4): 28 КБ классов на ~270 стран
// блокировали первую отрисовку каждой страницы, а флаги рисует только профиль. Импорт из
// компонента кладёт их в CSS тех маршрутов, где компонент есть.
import 'flag-icons/css/flag-icons.min.css'
import { cn } from '../lib/utils'

// Флаг страны через flag-icons (SVG всех стран, локально в бандле — offline-safe).
// code — ISO 3166-1 alpha-2 (регистр не важен).
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
