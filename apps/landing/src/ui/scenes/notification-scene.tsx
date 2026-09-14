import { Bell, Clock, MapPin } from 'lucide-react'
import type { Dictionary } from '../../content'

/**
 * 07:40 — приходит уведомление о переносе пары, и карточка расписания меняет аудиторию.
 *
 * Петля бесконечная (8 с): это же сцена первого экрана, и там она должна жить сама,
 * без участия человека.
 *
 * Поля не задаёт: их держит DeviceFrame, одни на все сцены. Корень — `relative`, чтобы
 * уведомление легло ровно по ширине содержимого, а не по внутреннему краю корпуса.
 */
export function NotificationScene({ dict }: { dict: Dictionary }) {
  const t = dict.scenes.notification

  return (
    <div className="relative flex h-full flex-col gap-3">
      <span className="text-[0.7rem] font-medium text-muted-foreground">{t.scheduleTitle}</span>

      {/* Та самая пара, которую переносят */}
      <div
        className="sh-loop-flash sh-row-in rounded-xl border border-border bg-card p-3"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[0.8rem] leading-tight font-semibold">{t.pairName}</span>
          <span className="shrink-0 text-[0.65rem] text-foreground/75 tabular-nums">09:00</span>
        </div>
        <p className="mt-1 text-[0.7rem] text-foreground/70">{t.pairTeacher}</p>

        <div className="mt-2 flex items-center gap-1.5">
          <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          {/* Старая и новая аудитории лежат друг на друге: меняется только opacity,
              поэтому подмена не двигает раскладку карточки. */}
          <span className="relative inline-grid text-[0.7rem] font-medium">
            <span className="sh-loop-room-old col-start-1 row-start-1">{t.roomBefore}</span>
            <span className="sh-loop-room-new col-start-1 row-start-1 text-primary">
              {t.roomAfter}
            </span>
          </span>
          <span className="sh-loop-room-new rounded bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
            {t.changedLabel}
          </span>
        </div>
      </div>

      {/* Следующая пара — фон, чтобы экран не выглядел пустым */}
      <div
        className="sh-row-in rounded-xl border border-border bg-card/60 p-3"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[0.8rem] leading-tight font-medium">{t.nextPair}</span>
          <span className="shrink-0 text-[0.65rem] text-foreground/75 tabular-nums">
            {t.nextPairTime}
          </span>
        </div>
        {/* Только время: любая подпись здесь была бы строкой интерфейса, а строки
            интерфейса в проекте не хардкодятся (AGENTS.md, запрет на текст мимо i18n). */}
        <div className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-foreground/70 tabular-nums">
          <Clock className="size-3" aria-hidden />
          <span>10:45 — 12:15</span>
        </div>
      </div>

      {/* Уведомление приезжает поверх экрана, по ширине содержимого. */}
      <div className="pointer-events-none absolute inset-x-0 top-0">
        <div className="sh-loop-notif flex items-start gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/10">
            <Bell className="size-3 text-primary" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[0.7rem] font-semibold">{t.title}</span>
            <span className="block text-[0.65rem] leading-snug text-muted-foreground">
              {t.text}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
