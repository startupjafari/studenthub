import { MapPin } from 'lucide-react'
import type { Dictionary } from '../../content'

/**
 * 09:00 — расписание дня.
 *
 * Пары въезжают по очереди, затем сверху опускается маркер «Сейчас» и встаёт у текущей.
 * Идущая пара подсвечена не только цветом, но и текстом метки — статус не может
 * держаться на одном цвете.
 *
 * Поля и высоту держит DeviceFrame; здесь — только содержимое и общий для сцен `gap-3`.
 */
export function ScheduleScene({ dict }: { dict: Dictionary }) {
  const t = dict.scenes.schedule
  const currentIndex = 0

  return (
    <div className="flex h-full flex-col gap-3">
      <span className="text-[0.7rem] font-medium text-muted-foreground">{t.title}</span>

      {/* Метка «Сейчас» выходит за левый край строки, поэтому у списка свой отступ
          слева — ровно под неё. Иначе метка налезала бы на поле рамки. */}
      <ul className="flex flex-col gap-2 pl-3">
        {t.pairs.map((pair, index) => {
          const isCurrent = index === currentIndex
          return (
            <li
              key={pair.name}
              className="sh-row-in relative"
              // Строки въезжают каскадом — задержка считается из индекса в CSS.
              style={{ '--i': index } as React.CSSProperties}
            >
              {isCurrent && (
                <div className="sh-now-drop absolute top-1/2 -left-3 z-10 flex -translate-y-1/2 items-center">
                  <span className="relative flex size-2">
                    <span className="sh-ping absolute inline-flex size-full rounded-full bg-primary" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                </div>
              )}

              <div
                className={[
                  'rounded-xl border p-3',
                  isCurrent ? 'border-primary/40 bg-primary/5' : 'border-border bg-card/60',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[0.75rem] leading-tight font-medium">{pair.name}</span>
                  <span className="shrink-0 text-[0.65rem] text-foreground/75 tabular-nums">
                    {pair.time}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[0.65rem] text-foreground/75">
                    <MapPin className="size-2.5 shrink-0" aria-hidden />
                    {pair.room}
                  </span>
                  {isCurrent && (
                    <span className="sh-now-drop rounded bg-primary px-1.5 py-px text-[0.55rem] font-semibold text-primary-foreground">
                      {t.nowLabel}
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
