import { DoorClosed, Users } from 'lucide-react'
import type { Dictionary } from '../../content'

/**
 * 14:30 — QR над дверью.
 *
 * Сначала окно сканера со сканирующей линией, следом выезжает карточка помещения:
 * занято, до скольки, какая пара и чья группа. Приём со сканирующей линией взят с
 * экрана сканера платформы — там он объясняет, что камера работает.
 */
export function RoomScene({ dict }: { dict: Dictionary }) {
  const t = dict.scenes.room

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Окно «камеры». Квадрат по центру: видоискатель, у которого стороны не равны,
          читается как случайный прямоугольник. */}
      <div
        className="sh-row-in relative mx-auto aspect-square w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-foreground/5"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        {/* Уголки видоискателя — одинаковые во всех четырёх углах. */}
        <span className="absolute top-2 left-2 size-4 rounded-tl-sm border-t-2 border-l-2 border-primary" />
        <span className="absolute top-2 right-2 size-4 rounded-tr-sm border-t-2 border-r-2 border-primary" />
        <span className="absolute bottom-2 left-2 size-4 rounded-bl-sm border-b-2 border-l-2 border-primary" />
        <span className="absolute right-2 bottom-2 size-4 rounded-br-sm border-r-2 border-b-2 border-primary" />

        {/* Схематичный QR: сетка модулей, а не настоящий код — сканировать тут нечего. */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid grid-cols-5 gap-0.5 opacity-60">
            {QR_PATTERN.map((filled, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-[1px] ${filled ? 'bg-foreground' : 'bg-transparent'}`}
              />
            ))}
          </div>
        </div>

        {/* Линия пробегает ровно высоту окна: 8rem минус две рамки. */}
        <div
          className="sh-scan absolute inset-x-0 top-0 h-0.5 bg-primary shadow-[0_0_12px_2px] shadow-primary/50"
          style={{ '--sh-scan-range': '126px' } as React.CSSProperties}
          aria-hidden
        />
      </div>

      <p className="text-center text-[0.6rem] leading-snug text-muted-foreground">{t.scanHint}</p>

      {/* Результат скана */}
      <div className="sh-after-scan rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <DoorClosed className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-[0.75rem] font-semibold">{t.roomName}</span>
          </span>
          {/* Статус читается и цветом, и словом: на печати и у дальтоников цвета нет. */}
          <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[0.55rem] font-semibold text-warning-foreground">
            {t.statusBusy}
          </span>
        </div>

        <p className="mt-1 text-[0.7rem] font-medium">{t.busyUntil}</p>

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2 text-[0.65rem] text-foreground/75">
          <span className="truncate">{t.pairName}</span>
          <span className="flex shrink-0 items-center gap-1">
            <Users className="size-2.5" aria-hidden />
            {t.group}
          </span>
        </div>
      </div>

      <p className="mt-auto text-center text-[0.6rem] font-medium text-success">{t.nextFree}</p>
    </div>
  )
}

/**
 * Узор 5×5 для схематичного QR: единица — закрашенный модуль. Записан строкой, потому что
 * так видно саму фигуру — с «глазами» по углам, как у настоящего кода. Сканировать тут
 * нечего и не нужно: это иллюстрация двери, а не рабочая ссылка.
 */
const QR_PATTERN = [...'1101110101011101010111011'].map((c) => c === '1')
