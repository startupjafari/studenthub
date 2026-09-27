import { cn } from '../lib/utils'

/**
 * Кольцо прогресса вокруг значка — как у скачивания файла в Telegram. Размер задаёт
 * родитель: кольцо растягивается на него целиком (`absolute inset-0`).
 *
 * `progress` null — размер неизвестен (сервер не прислал длину): кольцо крутится
 * четвертью окружности, а не стоит на нуле, иначе скачивание выглядело бы зависшим.
 */
export function ProgressRing({
  progress,
  className,
}: {
  /** 0…1 или null для неопределённого. */
  progress: number | null
  className?: string
}) {
  const r = 18
  const c = 2 * Math.PI * r
  const shown = progress === null ? 0.25 : Math.max(0.02, progress)
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 size-full -rotate-90',
        progress === null && 'animate-spin',
        className,
      )}
    >
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown)}
        className="transition-[stroke-dashoffset] duration-150"
      />
    </svg>
  )
}
