import type { ReactNode } from 'react'
import { Briefcase, Building2, GraduationCap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PLATFORM_LINKS, SALES_EMAIL } from '../config/site'
import type { Dictionary } from '../content'
import { Lift } from './press'
import { LinkButton, Reveal, Section, SectionHeading, type SectionTone } from './primitives'

/**
 * Три двери на платформу.
 *
 * Стоит сразу под первым экраном, до всякого рассказа о продукте: на корень домена
 * приходят не только покупатели, и двум аудиториям из трёх нужно не «узнать о
 * платформе», а найти свою страницу.
 *
 * Действия у дверей разные, и это главное отличие от прежней версии, где вся карточка
 * была одной ссылкой. Университету идти некуда — его дверь ведёт в почту; у студентов и
 * сотрудников действий два (войти либо узнать, как получить доступ), и одной ссылкой на
 * карточке они не выражаются.
 *
 * Адреса платформы сверены с `PUBLIC_PATHS` в apps/web/src/middleware.ts — это
 * единственные страницы продукта, которые открываются без аккаунта.
 */
export function Doors({ dict, tone }: { dict: Dictionary; tone?: SectionTone }) {
  const t = dict.doors
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(dict.cta.mailSubject)}`

  const doors: { icon: LucideIcon; door: { title: string; text: string }; actions: ReactNode }[] = [
    {
      icon: Building2,
      door: t.university,
      actions: (
        <LinkButton href={mailto} external variant="primary" size="sm">
          {t.university.action}
        </LinkButton>
      ),
    },
    {
      icon: GraduationCap,
      door: t.people,
      actions: (
        <>
          <LinkButton href={PLATFORM_LINKS.login} external variant="primary" size="sm">
            {t.people.action}
          </LinkButton>
          {/* Якорь ведёт не в начало вопросов, а на конкретный — тот, ради которого
                сюда и нажали. Идентификатор приходит из словаря (content/types.ts, Qa). */}
          <LinkButton href="#faq-access" variant="ghost" size="sm">
            {t.people.actionAccess}
          </LinkButton>
        </>
      ),
    },
    {
      icon: Briefcase,
      door: t.company,
      actions: (
        <LinkButton href={PLATFORM_LINKS.employerSignup} external variant="secondary" size="sm">
          {t.company.action}
        </LinkButton>
      ),
    },
  ]

  return (
    <Section tone={tone}>
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      {/* Три равные колонки: двери равнозначны, и ни одна не должна выглядеть главной.
          h-full на карточке выравнивает их по высоте — иначе колонка с коротким текстом
          обрывается выше соседних и ряд читается как ошибка вёрстки. */}
      <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {doors.map(({ icon: Icon, door, actions }, index) => (
          <Reveal key={door.title} delay={index} className="h-full">
            <Lift lift={-3} className="h-full">
              <div className="flex h-full flex-col gap-4 rounded-3xl border border-hairline bg-surface p-6 transition-colors hover:border-primary/40 sm:p-7">
                <span className="grid size-11 place-items-center rounded-2xl border border-hairline bg-surface">
                  <Icon className="size-5 text-primary" aria-hidden />
                </span>
                <span className="font-display text-[1.0625rem] leading-snug font-semibold tracking-[-0.015em]">
                  {door.title}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{door.text}</span>
                {/* mt-auto прижимает действия к низу: у карточек разной длины кнопки
                    оказываются на одной линии, и ряд читается как ряд. */}
                <span className="mt-auto flex flex-wrap items-center gap-2 pt-2">{actions}</span>
              </div>
            </Lift>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
