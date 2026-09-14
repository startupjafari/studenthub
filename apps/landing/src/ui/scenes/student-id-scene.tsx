import { BadgeCheck, GraduationCap, WifiOff } from 'lucide-react'
import type { Dictionary } from '../../content'

/**
 * 18:00 — цифровой студенческий.
 *
 * Поверх карты бежит голографический блик. В платформе это анти-подделочная мера: на
 * скриншоте блик застывает, и подменить живую карту картинкой труднее. Здесь он работает
 * как наглядное объяснение, почему пропуск в телефоне — это пропуск, а не фотография.
 *
 * Экран наполнен так же, как остальные сцены: заголовок раздела сверху, карта, штрихкод
 * для вахты и подпись. Карта, висящая одна посреди пустого телефона, выглядела забытой —
 * и рядом с текстом слева раскладка читалась как съехавшая.
 */
export function StudentIdScene({ dict }: { dict: Dictionary }) {
  const t = dict.scenes.studentId

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.7rem] font-medium text-muted-foreground">{t.screenTitle}</span>
        <span className="flex items-center gap-1 rounded bg-success/12 px-1.5 py-0.5 text-[0.55rem] font-medium text-success">
          <WifiOff className="size-2.5" aria-hidden />
          {t.offlineBadge}
        </span>
      </div>

      <div
        className="sh-row-in relative isolate overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        {/* Голографический блик поверх карты; кликов не перехватывает. */}
        <div className="sh-holo pointer-events-none absolute inset-0 z-20" aria-hidden />

        <div className="flex items-center gap-2 bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 text-primary-foreground">
          <GraduationCap className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold">{t.cardLabel}</span>
          <BadgeCheck className="size-3.5 shrink-0 opacity-80" aria-hidden />
        </div>

        <div className="flex items-center gap-3 p-4">
          {/* Место под фото: силуэт, а не выдуманный человек со стока. */}
          <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted">
            <span className="text-sm font-bold text-muted-foreground">{t.name.charAt(0)}</span>
          </div>

          {/* Имя переносится, а не обрезается: фамилия под многоточием — это брак
              документа, а не аккуратная вёрстка. */}
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[0.78rem] leading-tight font-semibold text-balance">
              {t.name}
            </span>
            <span className="text-[0.62rem] leading-snug text-foreground/70">{t.faculty}</span>
            <span className="text-[0.62rem] font-medium text-foreground/75">{t.group}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <span className="text-[0.6rem] text-muted-foreground">{t.validLabel}</span>
          <span className="text-[0.7rem] font-semibold tabular-nums">{t.valid}</span>
        </div>
      </div>

      {/* Штрихкод для вахты: набор полос разной толщины — узнаваемая форма, не данные. */}
      <div
        className="sh-row-in flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="flex h-9 items-end gap-[2px]" aria-hidden>
          {BARCODE.map((weight, i) => (
            <span
              key={i}
              className="h-full rounded-[1px] bg-foreground/80"
              style={{ width: `${weight}px` }}
            />
          ))}
        </div>
        <span className="text-center text-[0.58rem] leading-snug text-muted-foreground">
          {t.passHint}
        </span>
      </div>
    </div>
  )
}

/** Толщина полос штрихкода в пикселях. Узор постоянный — это картинка, а не кодировка. */
const BARCODE = [2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 3, 1, 2, 2, 1, 3, 1, 2]
