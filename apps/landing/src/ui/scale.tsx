import type { Dictionary } from '../content'
import { Lift } from './motion'
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
 *
 * Плиток с рамками у чисел больше нет. Цифра такого кегля сама держит место, а коробка
 * вокруг неё только отнимала воздух и спорила с карточками ниже.
 */
export function Scale({ dict }: { dict: Dictionary }) {
  const t = dict.scale

  return (
    <Section>
      <SectionHeading title={t.title} subtitle={t.text} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {t.stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index} className="flex flex-col gap-3">
            <span className="sh-title font-display text-[clamp(2.1rem,4.6vw,3.85rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums">
              {/* Начальное значение — 0: до появления число не должно мелькать готовым. */}
              <span data-count={stat.value}>0</span>
              {stat.unit && <span>{stat.unit}</span>}
            </span>
            <span className="max-w-[18ch] text-sm leading-snug text-muted-foreground">
              {stat.label}
            </span>
          </Reveal>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {t.facts.map((fact, index) => (
          <Reveal key={fact.title} delay={index} className="h-full">
            <Lift lift={-3} className="h-full">
              <div className="flex h-full flex-col gap-3 rounded-3xl border border-hairline bg-surface p-6">
                <span className="font-display text-base font-semibold tracking-[-0.015em]">
                  {fact.title}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{fact.text}</span>
              </div>
            </Lift>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
