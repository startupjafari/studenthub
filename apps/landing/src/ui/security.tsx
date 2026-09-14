import { Check } from 'lucide-react'
import type { Dictionary } from '../content'
import { Lift } from './motion'
import { Reveal, Section, SectionHeading } from './primitives'

/**
 * Безопасность и приватность.
 *
 * Блок, ради которого проректор дочитывает страницу. Каждый пункт — правда о коде,
 * проверяемая по docs/BACKEND_RULES.md; обещаний «будет в следующем релизе» здесь нет
 * и быть не может: это ровно тот текст, который потом проверят на демонстрации.
 */
export function Security({ dict }: { dict: Dictionary }) {
  const t = dict.security

  return (
    <Section id="security">
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      {/* Шесть пунктов: 1 → 2 → 3 колонки. На каждой ширине ряд полный, «хвоста» из одной
          карточки в конце не бывает. */}
      <ul className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {t.points.map((point, index) => (
          <Reveal as="li" key={point.title} delay={index % 3} className="h-full">
            <Lift lift={-3} className="h-full">
              <div className="flex h-full flex-col gap-4 rounded-3xl border border-hairline bg-surface p-6 transition-colors hover:border-foreground/20">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-hairline bg-surface">
                  <Check className="size-4 text-success" aria-hidden />
                </span>
                <span className="font-display text-base leading-snug font-semibold tracking-[-0.015em]">
                  {point.title}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{point.text}</span>
              </div>
            </Lift>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}
