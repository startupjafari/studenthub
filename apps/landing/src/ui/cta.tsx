import { SALES_EMAIL } from '../config/site'
import type { Dictionary } from '../content'
import { Container, LinkButton, Reveal } from './primitives'

/**
 * Призыв — вторая брендовая полоса страницы.
 *
 * Пока это кнопка «написать нам», а не форма: настоящая форма требует модели в базе,
 * публичного эндпоинта, защиты от спама и текста согласия на обработку персональных
 * данных — четыре решения, каждое за человеком (стоп-точки AGENTS.md). Они вынесены в
 * отдельный PR, и лендинг не ждёт их в ящике: почтовая ссылка лид не теряет.
 *
 * Полоса во всю ширину, а не карточка: вместе с первым экраном она обрамляет страницу.
 * Фоны секций между ними чередуются двумя нейтральными тонами, и цвет появляется ровно
 * дважды — там, где страница начинается, и там, где от человека ждут действия.
 *
 * Обещаний по срокам ответа здесь нет: письмо читает человек, а не робот, и «ответим за
 * час» — обязательство, которое страница взять не может.
 */
export function Cta({ dict }: { dict: Dictionary }) {
  const t = dict.cta
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.mailSubject)}`

  return (
    <section id="cta" className="sh-cta relative isolate scroll-mt-24 overflow-hidden">
      <span aria-hidden className="sh-cta__dots" />

      <Container className="py-[clamp(4.5rem,9vw,7.5rem)]">
        <Reveal className="relative flex max-w-xl flex-col items-start gap-6">
          <h2 className="font-display text-[clamp(1.7rem,3.2vw,2.6rem)] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-white">
            {t.title}
          </h2>

          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
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
        </Reveal>
      </Container>
    </section>
  )
}
