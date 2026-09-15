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
 * Разметка статическая, без JavaScript: LCP не должен ждать гидрации. Поэтому вход здесь
 * остаётся на CSS, хотя на остальной странице движением занимается Framer Motion —
 * анимация первого экрана обязана идти, пока бандл ещё едет. Клиентский код здесь ровно
 * один — подсветка меш-сетки за курсором.
 *
 * Синей панели под первым экраном больше нет: цветное полотно сверху и ровный фон снизу
 * делили страницу швом. Теперь экран стоит на общей земле, и цвет остался только там, где
 * он что-то значит, — на кнопке и второй строке заголовка.
 */
export function Hero({ dict }: { dict: Dictionary }) {
  const t = dict.hero
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(dict.cta.mailSubject)}`

  return (
    <MeshBackdrop>
      {/* Верхний отступ включает высоту шапки: она `fixed` и места в потоке не занимает. */}
      <Container className="grid items-center gap-[clamp(3rem,7vw,4.5rem)] pt-[calc(4.5rem+clamp(2.5rem,8vw,5.5rem))] pb-[clamp(4rem,10vw,7.5rem)] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col items-start">
          <span className="sh-soft-up inline-flex items-center gap-2.5 rounded-full border border-hairline bg-surface py-2 pr-4 pl-3 text-[0.8125rem] font-medium [--delay:0.05s]">
            {/* Точка-индикатор: платформа живая, а не витрина. Кольцо расходится и гаснет —
                без него точка читается просто как маркер списка. */}
            <span aria-hidden className="relative grid size-2 place-items-center">
              <span className="absolute inset-0 rounded-full bg-primary" />
              <span className="sh-ping absolute inset-0 rounded-full bg-primary" />
            </span>
            {t.eyebrow}
          </span>

          {/*
            Заголовок разбит на строки вручную: перенос здесь смысловой, а не случайный
            остаток от ширины окна. Каждая строка — своя маска, из-под которой она
            выезжает; поэтому строки и не могут быть «как получится».

            Вторая строка залита синим: акцент на странице один, и он достаётся тому, чем
            продукт отличается, — «в одном приложении».
          */}
          <h1 className="font-display mt-7 text-[clamp(2.05rem,5.8vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.038em] text-balance">
            {t.titleLines.map((line, index) => (
              <span key={line} className="reveal-line">
                <span
                  className={index === t.titleLines.length - 1 ? 'sh-title-accent' : 'sh-title'}
                >
                  {line}
                </span>
              </span>
            ))}
          </h1>

          <p className="sh-soft-up mt-7 max-w-[48ch] text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-muted-foreground">
            {t.subtitle}
          </p>

          {/* Кнопки — в строку с переносом: на 375 px они обязаны остаться над сгибом. */}
          <div className="sh-soft-up mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap [--delay:0.5s]">
            <LinkButton href={mailto} external variant="primary">
              {t.ctaDemo}
            </LinkButton>
            <LinkButton href="#product" variant="secondary">
              {t.ctaProduct}
            </LinkButton>
          </div>

          <p className="sh-soft-up mt-7 max-w-[46ch] text-sm leading-relaxed text-muted-foreground [--delay:0.85s]">
            {t.inviteHint}{' '}
            <a
              href={PLATFORM_LINKS.login}
              rel="noopener"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              {dict.nav.login}
            </a>
          </p>
        </div>

        <div className="sh-soft-up flex justify-center lg:justify-end [--delay:0.4s]">
          <Scene scene="notification" dict={dict} />
        </div>
      </Container>
    </MeshBackdrop>
  )
}
