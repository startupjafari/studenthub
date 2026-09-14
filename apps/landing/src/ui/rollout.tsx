import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading } from './primitives'

/**
 * Внедрение — снимает возражение «нам это разворачивать полгода».
 *
 * Нумерация здесь не украшение: это настоящая цепочка приглашений из docs/PROJECT.md §2.1,
 * и порядок шагов принципиален — пригласить студента раньше, чем заведён его декан,
 * платформа просто не даст. Поэтому на широком экране шаги связаны линией: это
 * последовательность, а не четыре независимые карточки.
 *
 * Карточек у шагов больше нет: рамка вокруг каждого превращала цепочку в четыре коробки.
 * Остались номер, заголовок и текст на общей земле — связь держит линия.
 */
export function Rollout({ dict }: { dict: Dictionary }) {
  const t = dict.rollout

  return (
    <Section id="rollout">
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      <div className="relative">
        {/*
          Линия-связка. Идёт от центра первого номера до центра последнего, а не во всю
          ширину: концы, торчащие за крайние кружки, читались бы как обрыв. Отступы по
          12.5% — это половина колонки при четырёх равных колонках.
        */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-[1.625rem] right-[12.5%] left-[12.5%] hidden h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent lg:block"
        />

        <ol className="relative grid items-start gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {t.steps.map((step, index) => (
            <Reveal as="li" key={step.title} delay={index} className="flex flex-col gap-4">
              {/* Кружок непрозрачный, с фоном страницы: линия-связка проходит под ним и
                  не должна просвечивать сквозь номер. */}
              <span className="sh-glow grid size-13 shrink-0 place-items-center rounded-full border border-primary/30 bg-background font-mono text-[0.9375rem] font-medium text-primary tabular-nums">
                {index + 1}
              </span>
              <span className="font-display text-base leading-snug font-semibold tracking-[-0.015em] text-balance">
                {step.title}
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{step.text}</span>
            </Reveal>
          ))}
        </ol>
      </div>

      <Reveal>
        <p className="max-w-2xl border-t border-hairline pt-8 text-sm leading-relaxed text-muted-foreground">
          {t.note}
        </p>
      </Reveal>
    </Section>
  )
}
