import {
  BriefcaseBusiness,
  Cctv,
  FileText,
  Library,
  Map as MapIcon,
  MessagesSquare,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Dictionary } from '../content'
import { Lift } from './press'
import { Reveal, Section, SectionHeading, type SectionTone } from './primitives'

/**
 * Иконки модулей — те же, что у этих разделов в меню платформы
 * (apps/web/src/widgets/app-shell/model/nav.ts): человек, увидевший значок здесь, узнаёт
 * его потом в приложении. Импортировать их оттуда нельзя — лендинг изолирован
 * (docs/LANDING.md §3), поэтому соответствие держится руками.
 */
const MODULE_ICONS: Record<string, LucideIcon> = {
  campus: MapIcon,
  library: Library,
  security: Cctv,
  communication: MessagesSquare,
  career: BriefcaseBusiness,
  templates: FileText,
}

/**
 * Модули сверх учебного процесса.
 *
 * Роли выше показывают учёбу — расписание, заявки, ведомость. Но вуз покупает не только
 * это, и о кампусе, библиотеке, посте охраны и карьере страница раньше молчала, хотя всё
 * это в продукте уже работает. Каждая карточка сверена с кодом: формулировки точные, а не
 * рекламные, потому что их проверят на демонстрации так же, как пункты «Безопасности».
 *
 * Камеры живут здесь, а не в «Безопасности»: та отвечает на вопрос «как защищены данные»,
 * а камеры — это раздел для охраны. Два места про одно и то же читались бы как повтор.
 *
 * Серверный компонент: на клиент уезжает только обёртка появления (`Reveal`), тексты на
 * трёх языках остаются в серверной разметке (docs/LANDING.md §4.1).
 */
export function Modules({ dict, tone }: { dict: Dictionary; tone?: SectionTone }) {
  const t = dict.modules

  return (
    <Section id="modules" tone={tone}>
      <SectionHeading title={t.title} subtitle={t.subtitle} />

      {/* Шесть карточек: 1 → 2 → 3 колонки, как у «Безопасности», — на каждой ширине ряд
          полный. Иконка в цвете бренда, как у «Дверей»: это разделы продукта, а не
          галочки-гарантии. */}
      <ul className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {t.items.map((item, index) => {
          const Icon = MODULE_ICONS[item.id] ?? Sparkles
          return (
            <Reveal as="li" key={item.id} delay={index % 3} className="h-full">
              <Lift lift={-3} className="h-full">
                <div className="flex h-full flex-col gap-4 rounded-3xl border border-hairline bg-surface p-6 transition-colors hover:border-primary/40 sm:p-7">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-hairline bg-surface">
                    <Icon className="size-5 text-primary" aria-hidden />
                  </span>
                  <span className="font-display text-[1.0625rem] leading-snug font-semibold tracking-[-0.015em]">
                    {item.title}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{item.text}</span>
                </div>
              </Lift>
            </Reveal>
          )
        })}
      </ul>
    </Section>
  )
}
