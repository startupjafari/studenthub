import { Check } from 'lucide-react'
import type { Dictionary } from '../content'
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
    <Section id="security" className="bg-muted/40">
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      {/* Шесть пунктов ложатся в 2×3 — ряд всегда полный, «хвоста» из одной карточки
          в конце не бывает. */}
      <ul className="grid items-stretch gap-4 sm:grid-cols-2">
        {t.points.map((point, index) => (
          <Reveal
            as="li"
            key={point.title}
            delay={index % 2}
            className="sh-lift flex h-full gap-3 rounded-2xl border border-border bg-card p-5"
          >
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success/12">
              <Check className="size-3.5 text-success" aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{point.title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{point.text}</span>
            </span>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}
