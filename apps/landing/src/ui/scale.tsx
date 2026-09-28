import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading, type SectionTone } from './primitives'

/**
 * Масштаб.
 *
 * Здесь по обыкновению стоял бы счётчик «10 000 счастливых студентов». Его нет намеренно:
 * продукт молодой, придуманная метрика разваливается на первом же уточняющем вопросе, а
 * доверие после этого не возвращается. Числа ниже — свойства самого продукта, и
 * подзаголовок секции говорит об этом прямо.
 *
 * Числа набегают при появлении (`data-count`, механика в SiteMotion) — движение здесь
 * несёт смысл: величина читается, пока цифра растёт. Ноль исключение: набегать ему
 * неоткуда, и счётчик на нём выглядел бы сломанным, а не выразительным.
 *
 * Плиток с рамками у чисел больше нет. Цифра такого кегля сама держит место, а коробка
 * вокруг неё только отнимала воздух.
 */
export function Scale({ dict, tone }: { dict: Dictionary; tone?: SectionTone }) {
  const t = dict.scale

  return (
    <Section tone={tone}>
      <SectionHeading title={t.title} subtitle={t.text} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
        {t.stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index} className="flex flex-col gap-3">
            <span className="sh-title font-display text-[clamp(2.1rem,4.6vw,3.85rem)] leading-none font-semibold tracking-[-0.04em] tabular-nums">
              {/* Начальное значение — 0: до появления число не должно мелькать готовым.
                  У самого нуля разбега нет, поэтому он и не считается. */}
              {stat.value === 0 ? <span>0</span> : <span data-count={stat.value}>0</span>}
            </span>
            <span className="max-w-[20ch] text-sm leading-snug text-muted-foreground">
              {stat.label}
            </span>
            {/* Оговорка мельче подписи: она уточняет число, а не описывает его. */}
            {stat.note && (
              <span className="max-w-[20ch] text-xs leading-snug text-muted-foreground/70">
                {stat.note}
              </span>
            )}
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
