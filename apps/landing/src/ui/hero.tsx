import type { Dictionary } from '../content'
import { PLATFORM_LINKS } from '../config/site'
import { Container, LinkButton } from './primitives'
import { MeshBackdrop } from './mesh-backdrop'

/**
 * Первый экран.
 *
 * Одна колонка по центру, и на ней ровно четыре вещи: обещание, объяснение и две
 * кнопки. Ни списка возможностей, ни чисел здесь нет намеренно — человек, который
 * только что открыл незнакомый домен, решает один вопрос: «это вообще про меня?»
 * Перечисление функций на этот вопрос не отвечает, а место занимает.
 *
 * Иллюстрации тоже нет. Раньше справа стоял нарисованный телефон с уведомлением о
 * переносе пары; он ушёл вместе с секцией «Один день», и возвращать его сюда одного
 * незачем: продукт показывают «Роли» ниже, целиком и по ролям.
 *
 * Единственный оркестрованный вход на странице: строки заголовка поднимаются из-под
 * маски одна за другой, следом проявляются подзаголовок и кнопки. Дальше по странице
 * движение уже другое — блоки просто всплывают при прокрутке.
 *
 * Разметка статическая, без JavaScript: LCP не должен ждать гидрации. Поэтому вход
 * здесь остаётся на CSS, хотя на остальной странице движением занимается Framer Motion.
 * Клиентский код тут ровно один — подсветка меш-сетки за курсором.
 */
export function Hero({ dict }: { dict: Dictionary }) {
  const t = dict.hero

  return (
    <MeshBackdrop>
      {/* Верхний отступ включает высоту шапки: она `fixed` и места в потоке не занимает. */}
      <Container className="flex flex-col items-center pt-[calc(4.5rem+clamp(3rem,9vw,6.5rem))] pb-[clamp(4.5rem,11vw,8rem)] text-center">
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

          Последняя строка залита синим: акцент на странице один, и он достаётся тому,
          ради чего вуз это и внедряет, — готовому результату вместо очереди.
        */}
        <h1 className="font-display mt-7 max-w-[20ch] text-[clamp(2.05rem,5.6vw,4.25rem)] leading-[1.03] font-semibold tracking-[-0.038em] text-balance">
          {t.titleLines.map((line, index) => (
            <span key={line} className="reveal-line">
              <span className={index === t.titleLines.length - 1 ? 'sh-title-accent' : 'sh-title'}>
                {line}
              </span>
            </span>
          ))}
        </h1>

        <p className="sh-soft-up mt-7 max-w-[54ch] text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-muted-foreground">
          {t.subtitle}
        </p>

        {/* Кнопки — в строку с переносом: на 360 px они обязаны остаться над сгибом. */}
        <div className="sh-soft-up mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row sm:flex-wrap [--delay:0.5s]">
          <LinkButton href={PLATFORM_LINKS.demoRequest} external variant="primary">
            {t.ctaDemo}
          </LinkButton>
          <LinkButton href={PLATFORM_LINKS.login} external variant="secondary">
            {t.ctaLogin}
          </LinkButton>
        </div>
      </Container>
    </MeshBackdrop>
  )
}
