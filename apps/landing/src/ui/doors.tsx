import { ArrowRight, Building2, GraduationCap, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PLATFORM_LINKS } from '../config/site'
import type { Dictionary, Item } from '../content/types'
import { Lift } from './motion'
import { Reveal, Section, SectionHeading } from './primitives'

/**
 * Три двери на платформу.
 *
 * Стоит сразу под первым экраном, до всякого рассказа о продукте: на корень домена
 * приходят не только покупатели, и трём аудиториям из четырёх нужно не «узнать о
 * платформе», а найти свою страницу. Все три адреса — рабочие и публичные (сверено с
 * PUBLIC_PATHS в apps/web/src/middleware.ts).
 */
export function Doors({ dict }: { dict: Dictionary }) {
  const t = dict.doors

  const doors: { item: Item; href: string; icon: LucideIcon }[] = [
    { item: t.student, href: PLATFORM_LINKS.login, icon: GraduationCap },
    { item: t.company, href: PLATFORM_LINKS.employerSignup, icon: Building2 },
    { item: t.verify, href: PLATFORM_LINKS.verifyDocument, icon: ShieldCheck },
  ]

  return (
    <Section>
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      {/* Три равные колонки: двери равнозначны, и ни одна не должна выглядеть главной.
          h-full на карточке выравнивает их по высоте — иначе колонка с коротким текстом
          обрывается выше соседних и ряд читается как ошибка вёрстки. */}
      <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {doors.map(({ item, href, icon: Icon }, index) => (
          <Reveal key={href} delay={index} className="h-full">
            <Lift className="h-full">
              <a
                href={href}
                rel="noopener"
                className="group flex h-full flex-col gap-4 rounded-3xl border border-hairline bg-surface p-6 transition-colors hover:border-primary/40 focus-visible:ring-4 focus-visible:ring-ring/25 focus-visible:outline-none sm:p-7"
              >
                <span className="grid size-11 place-items-center rounded-2xl border border-hairline bg-surface">
                  <Icon className="size-5 text-primary" aria-hidden />
                </span>
                <span className="font-display text-[1.0625rem] leading-snug font-semibold tracking-[-0.015em]">
                  {item.title}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{item.text}</span>
                {/* mt-auto прижимает действие к низу: у карточек разной длины стрелки
                    оказываются на одной линии, и ряд читается как ряд. */}
                <span className="mt-auto inline-flex items-center gap-2 pt-2 text-sm font-semibold text-primary">
                  {t.action}
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                    aria-hidden
                  />
                </span>
              </a>
            </Lift>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
