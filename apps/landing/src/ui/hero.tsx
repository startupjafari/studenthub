import type { Dictionary } from '../content'
import { PLATFORM_LINKS, SALES_EMAIL } from '../config/site'
import { Container, LinkButton } from './primitives'
import { MeshBackdrop } from './mesh-backdrop'
import { Scene } from './scenes'

/**
 * Первый экран.
 *
 * Единственный оркестрованный вход на странице: строки заголовка поднимаются из-под
 * маски одна за другой, следом проявляются подзаголовок и кнопки. Дальше по странице
 * движение уже другое — блоки просто всплывают при прокрутке.
 *
 * Разметка статическая, без JavaScript: LCP не должен ждать гидрации. Клиентский код
 * здесь ровно один — подсветка меш-сетки за курсором.
 */
export function Hero({ dict }: { dict: Dictionary }) {
  const t = dict.hero
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(dict.cta.mailSubject)}`

  return (
    <MeshBackdrop>
      {/* Верхний отступ включает высоту шапки: она `fixed` и места в потоке не занимает. */}
      <Container className="grid items-center gap-[clamp(2.5rem,6vw,4rem)] pt-[calc(4.5rem+clamp(2.5rem,8vw,5.5rem))] pb-[clamp(4rem,10vw,7.5rem)] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col items-start">
          <span className="sh-soft-up rounded-full border border-primary-foreground/25 px-3 py-1 text-xs font-medium tracking-wide [--delay:0.05s]">
            {t.eyebrow}
          </span>

          {/*
            Заголовок разбит на строки вручную: перенос здесь смысловой, а не случайный
            остаток от ширины окна. Каждая строка — своя маска, из-под которой она
            выезжает; поэтому строки и не могут быть «как получится».
          */}
          <h1 className="mt-6 text-[clamp(1.9rem,5.6vw,4.25rem)] leading-[1.08] font-bold tracking-tight text-balance">
            {t.titleLines.map((line) => (
              <span key={line} className="reveal-line">
                <span>{line}</span>
              </span>
            ))}
          </h1>

          <p className="sh-soft-up mt-7 max-w-[46ch] text-[clamp(1rem,1.5vw,1.15rem)] leading-relaxed text-primary-foreground/85">
            {t.subtitle}
          </p>

          {/* Кнопки — в строку с переносом: на 375 px они обязаны остаться над сгибом. */}
          <div className="sh-soft-up mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap [--delay:0.5s]">
            {/* Инверсная кнопка на брендовом фоне. Именно токенами, не сырым `bg-white`:
                --primary-foreground белый в обеих темах, поэтому пара primary-foreground /
                primary остаётся контрастной и в тёмной. */}
            <LinkButton
              href={mailto}
              external
              variant="secondary"
              className="border-transparent bg-primary-foreground text-primary hover:opacity-90"
            >
              {t.ctaDemo}
            </LinkButton>
            <LinkButton
              href="#product"
              variant="ghost"
              className="border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
            >
              {t.ctaProduct}
            </LinkButton>
          </div>

          <p className="sh-soft-up mt-6 text-sm text-primary-foreground/70 [--delay:0.85s]">
            {t.inviteHint}{' '}
            <a
              href={PLATFORM_LINKS.login}
              rel="noopener"
              className="font-medium underline underline-offset-4 hover:text-primary-foreground"
            >
              {dict.nav.login}
            </a>
          </p>
        </div>

        <div className="sh-soft-up [--delay:0.4s]">
          <Scene scene="notification" dict={dict} />
        </div>
      </Container>
    </MeshBackdrop>
  )
}
