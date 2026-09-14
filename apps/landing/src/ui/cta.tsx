import { SALES_EMAIL } from '../config/site'
import type { Dictionary } from '../content'
import { Container, LinkButton, Reveal } from './primitives'

/**
 * Заявка на демонстрацию.
 *
 * Пока это кнопка «написать нам», а не форма: настоящая форма требует модели в базе,
 * публичного эндпоинта, защиты от спама и текста согласия на обработку персональных
 * данных — четыре решения, каждое за человеком (стоп-точки AGENTS.md). Они вынесены в
 * отдельный PR, и лендинг не ждёт их в ящике: почтовая ссылка лид не теряет.
 *
 * Раньше призыв занимал полосу во всю ширину с меш-сеткой и держал рамку страницы вместе
 * с первым экраном. Рамка больше не нужна: фон теперь один на весь документ, и полоса
 * цвета во всю ширину читалась бы как чужой блок. Осталась карточка — единственное синее
 * пятно на странице, и оно там, где от человека ждут действия.
 */
export function Cta({ dict }: { dict: Dictionary }) {
  const t = dict.cta
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.mailSubject)}`

  return (
    <section id="cta" className="scroll-mt-24 pb-[clamp(4rem,8vw,7rem)]">
      <Container>
        <Reveal>
          <div className="sh-cta relative isolate overflow-hidden rounded-[1.75rem] px-6 py-12 sm:px-12 sm:py-16">
            <span aria-hidden className="sh-cta__dots" />

            <div className="relative flex max-w-xl flex-col items-start gap-5">
              <h2 className="font-display text-[clamp(1.7rem,3.2vw,2.6rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-white">
                {t.title}
              </h2>
              <p className="text-[clamp(0.975rem,1.3vw,1.1rem)] leading-relaxed text-white/85">
                {t.text}
              </p>

              <div className="mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                {/* Инверсная кнопка: на брендовом полотне белая плашка — самый заметный
                    элемент, и это правильный порядок, тут её и нажимают. */}
                <LinkButton
                  href={mailto}
                  external
                  variant="secondary"
                  className="border-transparent bg-white text-primary shadow-none hover:bg-white/90"
                >
                  {t.button}
                </LinkButton>
                <a
                  href={mailto}
                  rel="noopener"
                  className="font-mono text-sm text-white/85 underline underline-offset-4 hover:text-white"
                >
                  {SALES_EMAIL}
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
