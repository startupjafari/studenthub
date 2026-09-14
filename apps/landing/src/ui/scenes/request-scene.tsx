import { Check, FileText, Paperclip, Timer } from 'lucide-react'
import type { Dictionary } from '../../content'

/**
 * 12:15 — заявка на справку и её путь по статусам.
 *
 * Полоса прогресса дотягивается до текущего шага, шаги загораются вслед за ней. Это
 * статусная модель заявок из платформы, сведённая к четырём точкам: студент видит, где
 * его бумага, и не ходит спрашивать.
 */
export function RequestScene({ dict }: { dict: Dictionary }) {
  const t = dict.scenes.request
  // Заявка «готовится»: третий шаг из четырёх — сюжет про ожидание, а не про финал.
  const currentStep = 2
  const total = t.steps.length

  /*
    Геометрия шкалы.

    Шаги стоят в сетке из равных колонок, поэтому кружок каждого — в центре своей
    колонки, то есть на (i + 0.5) / N ширины. Линия обязана идти от центра первого
    кружка до центра последнего, а не от края до края: при `justify-between` и линии
    во всю ширину её концы торчали из-под крайних кружков, и шкала выглядела съехавшей.
  */
  const half = 100 / total / 2
  const trackWidth = 100 - 2 * half
  const filled = total > 1 ? (currentStep / (total - 1)) * trackWidth : 0

  return (
    <div className="flex h-full flex-col gap-3">
      <span className="text-[0.7rem] font-medium text-muted-foreground">{t.screenTitle}</span>

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10">
            <FileText className="size-3.5 text-primary" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[0.75rem] leading-tight font-semibold">{t.service}</span>
            <span className="block text-[0.65rem] text-muted-foreground tabular-nums">
              {t.title}
            </span>
          </span>
        </div>
      </div>

      {/* Шкала статусов */}
      <div className="relative">
        {/* Дорожка и заполнение — оба от центра первого кружка до центра последнего. */}
        <div
          className="absolute top-[0.625rem] h-0.5 -translate-y-1/2 rounded-full bg-border"
          style={{ left: `${half}%`, width: `${trackWidth}%` }}
          aria-hidden
        />
        <div
          className="sh-progress absolute top-[0.625rem] h-0.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${half}%`, width: `${filled}%` }}
          aria-hidden
        />

        {/* Равные колонки: кружки стоят строго по центрам, подписи — под своими кружками. */}
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
          {t.steps.map((step, index) => {
            const done = index < currentStep
            const active = index === currentStep
            const reached = done || active
            return (
              <li
                key={step}
                className={[
                  'flex flex-col items-center gap-1.5 px-0.5',
                  reached ? 'sh-step-on' : 'opacity-40',
                ].join(' ')}
                style={{ '--i': index } as React.CSSProperties}
              >
                <span
                  className={[
                    'grid size-5 place-items-center rounded-full text-[0.55rem] font-bold',
                    done
                      ? 'bg-primary text-primary-foreground'
                      : active
                        ? 'border-2 border-primary bg-background text-primary'
                        : 'border border-border bg-background text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? <Check className="size-2.5" aria-hidden /> : index + 1}
                </span>
                <span className="text-center text-[0.55rem] leading-tight text-balance text-muted-foreground">
                  {step}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Приложенные документы: заявка — это не пустая форма, а пакет с вложениями. */}
      <ul className="flex flex-col gap-1.5">
        {t.attachments.map((file, index) => (
          <li
            key={file}
            className="sh-row-in flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2"
            style={{ '--i': index + 2 } as React.CSSProperties}
          >
            <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-[0.65rem] text-muted-foreground">{file}</span>
            <Check className="ml-auto size-3 shrink-0 text-success" aria-hidden />
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center gap-2 rounded-xl border border-border bg-card/60 p-3">
        <Timer className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="block text-[0.6rem] text-muted-foreground">{t.etaLabel}</span>
          <span className="block text-[0.75rem] font-semibold">{t.eta}</span>
        </span>
      </div>
    </div>
  )
}
