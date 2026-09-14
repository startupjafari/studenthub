import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading } from './primitives'

/**
 * Масштаб.
 *
 * Здесь по обыкновению стоял бы счётчик «10 000 счастливых студентов». Его нет намеренно:
 * продукт молодой, придуманная метрика разваливается на первом же уточняющем вопросе, а
 * доверие после этого не возвращается. Числа ниже — про нагрузочный контур, который у
 * проекта действительно есть, и подпись под каждым говорит об этом прямо.
 *
 * Числа набегают при появлении (`data-count`, механика в SiteMotion) — движение здесь
 * несёт смысл: величина читается, пока цифра растёт.
 */
export function Scale({ dict }: { dict: Dictionary }) {
  const t = dict.scale

  return (
    <Section className="bg-muted/40">
      <SectionHeading title={t.title} subtitle={t.text} />

      {/* Сетка чисел: 2 колонки на телефоне, 4 на десктопе — обе делят ряд поровну.
          Разделители рисует фон-подложка, поэтому линии между плитками одинаковой
          толщины и не удваиваются на стыках. */}
      <Reveal className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
        {t.stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-2 bg-card px-5 py-7 text-center">
            <span className="text-[clamp(1.9rem,3.4vw,2.75rem)] leading-none font-semibold tracking-tight tabular-nums">
              {/* Начальное значение — 0: до появления число не должно мелькать готовым. */}
              <span data-count={stat.value}>0</span>
              {stat.unit && <span className="text-primary">{stat.unit}</span>}
            </span>
            <span className="mx-auto max-w-[18ch] text-sm leading-snug text-muted-foreground">
              {stat.label}
            </span>
          </div>
        ))}
      </Reveal>

      <div className="grid gap-4 md:grid-cols-3">
        {t.facts.map((fact, index) => (
          <Reveal
            key={fact.title}
            delay={index}
            className="sh-lift flex h-full flex-col gap-2 rounded-2xl border border-border bg-card p-6"
          >
            <span className="text-base font-semibold">{fact.title}</span>
            <span className="text-sm leading-relaxed text-muted-foreground">{fact.text}</span>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
