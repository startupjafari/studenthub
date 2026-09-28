import { ChevronDown } from 'lucide-react'
import { PLATFORM_LINKS } from '../config/site'
import type { Dictionary } from '../content'
import { Reveal, Section, SectionHeading, type SectionTone } from './primitives'

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
export function Faq({ dict, tone }: { dict: Dictionary; tone?: SectionTone }) {
  const t = dict.faq

  return (
    <Section id="faq" tone={tone}>
      <SectionHeading title={t.title} />

      <div className="flex flex-col gap-3">
        {t.items.map((item, index) => (
          <Reveal key={item.question} delay={index}>
            <details
              // Якорь на конкретный вопрос: на «Как получить доступ» ведёт кнопка из
              // «Дверей», и без него ссылка упиралась бы в начало всего списка.
              id={`faq-${item.id}`}
              // Общее имя делает группу настоящим аккордеоном: браузер сам закрывает
              // предыдущий вопрос. Нативно, без состояния и обработчиков; там, где
              // атрибут ещё не поддержан, блоки просто открываются независимо —
              // деградация, а не поломка.
              name="faq"
              className="group scroll-mt-28 rounded-3xl border border-hairline bg-surface px-6 transition-colors hover:border-foreground/20"
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
                    {/* Ссылка ровно у одного вопроса — того, где ответ без неё
                        заканчивается словами «на странице проверки», а страницы под
                        рукой нет. Двери на проверку документа на сайте больше нет, и
                        этот ответ остался единственным входом на неё. */}
                    {item.id === 'verify' && (
                      <>
                        {' '}
                        <a
                          href={PLATFORM_LINKS.verifyDocument}
                          rel="noopener"
                          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                        >
                          {t.verifyLink}
                        </a>
                      </>
                    )}
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
