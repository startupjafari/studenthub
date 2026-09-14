import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading } from './primitives'

/**
 * Внедрение — снимает возражение «нам это разворачивать полгода».
 *
 * Нумерация здесь не украшение: это настоящая цепочка приглашений из docs/PROJECT.md §2.1,
 * и порядок шагов принципиален — пригласить студента раньше, чем заведён его декан,
 * платформа просто не даст. Поэтому на широком экране шаги связаны линией: это
 * последовательность, а не четыре независимые карточки.
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
          className="pointer-events-none absolute top-[2.4rem] right-[12.5%] left-[12.5%] hidden h-px bg-border xl:block"
        />

        <ol className="relative grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
          {t.steps.map((step, index) => (
            <Reveal
              as="li"
              key={step.title}
              delay={index}
              className="sh-lift flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5"
            >
              {/* Номер и заголовок в одной строке: у всех карточек получается одинаковая
                  шапка высотой в кружок, и тексты ниже начинаются на одном уровне. */}
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="text-sm leading-tight font-semibold text-balance">
                  {step.title}
                </span>
              </div>
              <span className="text-sm leading-relaxed text-muted-foreground">{step.text}</span>
            </Reveal>
          ))}
        </ol>
      </div>

      <Reveal>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t.note}</p>
      </Reveal>
    </Section>
  )
}
