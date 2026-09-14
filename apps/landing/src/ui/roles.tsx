'use client'

import { useRef, useState } from 'react'
import { Building2, Check, GraduationCap, Shield, ShieldCheck, UserCog, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading } from './primitives'
import { AppMock } from './scenes/app-mock'

/**
 * Иконки ролей. Восемь текстовых пунктов в ряд сливаются в сплошную полосу — значок
 * даёт каждой вкладке опору для глаза и помогает вернуться к нужной после прокрутки.
 *
 * Живут в коде, а не в словаре: это часть интерфейса, а не текст для перевода.
 */
const ROLE_ICONS: Record<string, LucideIcon> = {
  student: GraduationCap,
  starosta: Users,
  teacher: UserCog,
  dean: Building2,
  universityModerator: Shield,
  universityAdmin: Building2,
  platformModerator: ShieldCheck,
  platformAdmin: Shield,
}

/**
 * Переключатель ролей.
 *
 * Отвечает на вопрос, который иначе занимает три абзаца: «а что увижу я?» И попутно
 * показывает главное про модель доступа — роли видят разное не потому, что лишнее
 * спрятано в интерфейсе, а потому что область данных задана ролью.
 *
 * Под описанием стоят права и строка `scope` — та самая область данных из токена, о
 * которой говорит подзаголовок секции. Это доказательство тезиса, а не его повторение
 * словами: видно, что именно ограничивает роль на уровне запроса.
 */
export function Roles({ dict }: { dict: Dictionary }) {
  const t = dict.roles
  const [activeIndex, setActiveIndex] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const active = t.tabs[activeIndex] ?? t.tabs[0]
  if (!active) return null

  /** Стрелки листают вкладки — того же ждут от role="tablist" (WAI-ARIA). */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const last = t.tabs.length - 1
    let next: number | null = null

    if (e.key === 'ArrowRight') next = activeIndex === last ? 0 : activeIndex + 1
    if (e.key === 'ArrowLeft') next = activeIndex === 0 ? last : activeIndex - 1
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = last

    if (next === null) return
    e.preventDefault()
    setActiveIndex(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <Section>
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      <Reveal className="flex flex-col gap-[clamp(1.75rem,3vw,2.5rem)]">
        {/*
          Ряд вкладок — такой же, как в платформе (apps/web/src/shared/ui/segmented-tabs.tsx):
          дорожка с рамкой и приглушённым фоном, активная вкладка подсвечена `primary/10`,
          а не залита сплошным синим.

          Восемь ролей в строку не помещаются нигде, кроме широкого десктопа, поэтому ряд
          прокручивается сам, а затухание у краёв сообщает, что вкладки продолжаются.
          Горизонтальной прокрутки страницы при этом не появляется — едет только ряд.
        */}
        <div className="sh-fade-x -mx-1 overflow-x-auto px-1 pb-1">
          <div
            role="tablist"
            aria-label={t.title}
            onKeyDown={handleKeyDown}
            className="flex w-max items-center gap-1 rounded-2xl border border-border bg-muted/50 p-1 lg:rounded-xl"
          >
            {t.tabs.map((tab, index) => {
              const selected = index === activeIndex
              const Icon = ROLE_ICONS[tab.id] ?? GraduationCap
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[index] = el
                  }}
                  type="button"
                  role="tab"
                  id={`role-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls="role-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveIndex(index)}
                  className={[
                    'flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap',
                    'outline-none focus-visible:ring-4 focus-visible:ring-ring/20 lg:min-h-9 lg:rounded-lg lg:px-3',
                    selected
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground',
                  ].join(' ')}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {tab.title}
                </button>
              )
            })}
          </div>
        </div>

        {/*
          Одна сетка на текст и макет, выравнивание по верхней кромке: раньше колонка с
          описанием центрировалась по высокому макету и начиналась много ниже его верха —
          блоки читались как поставленные по разным осям.
        */}
        <div
          role="tabpanel"
          id="role-panel"
          aria-labelledby={`role-tab-${active.id}`}
          className="grid items-start gap-[clamp(1.75rem,3vw,3rem)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
        >
          <div key={active.id} className="sh-swap flex flex-col gap-4">
            <h3 className="text-xl font-semibold">{active.title}</h3>
            {/* Описание — нейтральным серым. Акцентный синий на абзаце читается как
                ссылка; акцент в этом блоке принадлежит заголовку и активной вкладке. */}
            <p className="text-sm leading-relaxed text-foreground/70">{active.text}</p>

            {/* Права: одно предложение выше их не передаёт, а вузу важно именно это. */}
            <ul className="flex flex-col gap-2">
              {active.rights.map((right) => (
                <li key={right} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/12">
                    <Check className="size-2.5 text-primary" aria-hidden />
                  </span>
                  <span className="text-foreground/80">{right}</span>
                </li>
              ))}
            </ul>

            {/* Область данных как её видит бэкенд — моноширинным и мелко. */}
            {/* На 320 px строка области данных длиннее колонки — прокручивается сама,
                а не распирает раскладку. */}
            <code className="max-w-full overflow-x-auto rounded-md border border-border bg-muted/60 px-2.5 py-1.5 font-mono text-[0.7rem] whitespace-nowrap text-foreground/70">
              {active.scope}
            </code>
          </div>

          {/* key пересоздаёт макет: каскад строк проигрывается один раз, и без
              пересоздания при следующих переключениях содержимое просто подменялось бы. */}
          <div key={`mock-${active.id}`} className="sh-swap">
            <AppMock role={active} appName={dict.scenes.appName} />
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
