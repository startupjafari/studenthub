import { SALES_EMAIL } from '../config/site'
import type { Dictionary } from '../content'
import { Container, LinkButton, Reveal } from './primitives'
import { MeshBackdrop } from './mesh-backdrop'

/**
 * Заявка на демонстрацию.
 *
 * Пока это кнопка «написать нам», а не форма: настоящая форма требует модели в базе,
 * публичного эндпоинта, защиты от спама и текста согласия на обработку персональных
 * данных — четыре решения, каждое за человеком (стоп-точки AGENTS.md). Они вынесены в
 * отдельный PR, и лендинг не ждёт их в ящике: почтовая ссылка лид не теряет.
 *
 * Полоса брендовая — та же меш-сетка, что на первом экране. Страница получает рамку:
 * открывается и закрывается одним и тем же фоном, а светлые секции между ними читаются
 * как единый разворот. Заодно это восстанавливает чередование полос — иначе «Вопросы»
 * и призыв шли бы двумя светлыми подряд.
 */
export function Cta({ dict }: { dict: Dictionary }) {
  const t = dict.cta
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.mailSubject)}`

  return (
    <MeshBackdrop>
      <Container className="py-[clamp(4rem,9vw,8.25rem)]">
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
          <h2 className="text-[clamp(1.65rem,3vw,2.5rem)] leading-[1.12] font-semibold tracking-tight text-balance">
            {t.title}
          </h2>
          <p className="text-[clamp(1rem,1.4vw,1.125rem)] leading-relaxed text-primary-foreground/85">
            {t.text}
          </p>
          <LinkButton
            href={mailto}
            external
            variant="secondary"
            className="mt-1 border-transparent bg-primary-foreground text-primary hover:opacity-90"
          >
            {t.button}
          </LinkButton>
          <a
            href={mailto}
            rel="noopener"
            className="text-sm text-primary-foreground/70 underline underline-offset-4 hover:text-primary-foreground"
          >
            {SALES_EMAIL}
          </a>
        </Reveal>
      </Container>
    </MeshBackdrop>
  )
}
