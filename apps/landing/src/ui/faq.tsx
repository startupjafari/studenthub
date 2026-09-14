import { ChevronDown } from 'lucide-react'
import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading } from './primitives'

/**
 * Вопросы и ответы.
 *
 * На <details>/<summary>, а не на своём аккордеоне: раскрытие работает без JavaScript,
 * встроенный поиск по странице (Ctrl+F) находит текст внутри свёрнутого блока, а
 * скринридеры знают этот элемент без единого aria-атрибута.
 *
 * Плавность даёт приём `grid-template-rows: 0fr → 1fr` (.sh-acc__body в globals.css):
 * высоту содержимого браузер заранее не знает, и анимировать `height: auto` нельзя.
 *
 * Разметка FAQPage для поисковой выдачи добавляется в PR 4 (SEO) — из этого же словаря,
 * чтобы ответы в JSON-LD и на странице не разъехались.
 */
export function Faq({ dict }: { dict: Dictionary }) {
  const t = dict.faq

  return (
    <Section id="faq">
      <SectionHeading title={t.title} />

      <div className="flex flex-col gap-3">
        {t.items.map((item, index) => (
          <Reveal key={item.question} delay={index}>
            <details
              // Общее имя делает группу настоящим аккордеоном: браузер сам закрывает
              // предыдущий вопрос. Нативно, без состояния и обработчиков; там, где
              // атрибут ещё не поддержан, блоки просто открываются независимо —
              // деградация, а не поломка.
              name="faq"
              className="group rounded-3xl border border-hairline bg-surface px-6 transition-colors hover:border-foreground/20"
            >
              <summary className="font-display flex min-h-[3.5rem] cursor-pointer list-none items-center justify-between gap-4 py-5 text-[0.9375rem] font-semibold tracking-[-0.01em] focus-visible:ring-4 focus-visible:ring-ring/25 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <div className="sh-acc__body">
                <div>
                  <p className="sh-acc__inner max-w-[62ch] pb-6 text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </div>
              </div>
            </details>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
