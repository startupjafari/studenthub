'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, GraduationCap, Menu, X } from 'lucide-react'
import type { Locale } from '../config/site'
import { PLATFORM_LINKS, SALES_EMAIL, localePath } from '../config/site'
import type { Dictionary } from '../content'
import { AnimatePresence, EASE, motion, useReducedMotion } from './motion'
import { Container, LinkButton } from './primitives'
import { LanguageMenu } from './language-menu'

/** Разделы страницы в порядке следования — по ним же считается активный пункт. */
const SECTIONS = ['product', 'security', 'rollout', 'faq'] as const

/**
 * Шапка сайта.
 *
 * Закреплена сверху: на длинной странице «Войти» должно быть под рукой в любой момент.
 * При прокрутке она сжимается, отделяется тенью и уезжает наверх при движении вниз
 * (классы вешает SiteMotion), возвращаясь при первом же движении вверх.
 *
 * Позиционирование — `fixed`, не `sticky`: sticky остаётся в потоке, и сжатие высоты
 * подбрасывало бы весь контент под шапкой. Подробности в globals.css, `.sh-header`.
 *
 * Полупрозрачный фон с размытием и нижняя граница — не украшение: без них шапка сливается
 * с контентом, и на тёмной странице граница просто теряется при прокрутке.
 *
 * На мобильном навигация уходит в меню, а «Войти» остаётся на виду: это единственное
 * действие, ради которого сюда чаще всего и приходят.
 */
export function SiteHeader({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const calm = useReducedMotion()
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(dict.cta.mailSubject)}`

  const links = [
    { id: 'product', label: dict.nav.product },
    { id: 'security', label: dict.nav.security },
    { id: 'rollout', label: dict.nav.rollout },
    { id: 'faq', label: dict.nav.faq },
  ]

  // Какой раздел сейчас на экране. Без этого непонятно, где ты находишься на странице.
  useEffect(() => {
    const targets = SECTIONS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (targets.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Активным считается верхний из видимых разделов: при прокрутке в кадре почти
        // всегда два, и без этого правила подсветка прыгала бы между ними.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveSection(visible[0].target.id)
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: 0 },
    )

    targets.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Открытое меню не должно прокручивать страницу под собой.
  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  return (
    <>
      {/*
        Мобильное меню во весь экран. Разделы занимают всё, что есть, а действие прижато
        к нижнему краю: большим пальцем туда дотягиваются не глядя, и это единственная
        кнопка, ради которой меню вообще открывают дважды.

        Сосед шапки, а не её потомок: `position: fixed` внутри трансформируемого предка
        считается от предка, а `.sh-header` при прокрутке вниз уезжает через `transform`.
        z-40 против z-50 у шапки — строка с логотипом и крестиком остаётся сверху.
      */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="site-menu"
            initial={calm ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={calm ? undefined : { opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="fixed inset-0 z-40 flex flex-col bg-background pt-[calc(4.5rem+env(safe-area-inset-top))] lg:hidden"
          >
            <nav
              aria-label={dict.nav.product}
              className="flex-1 overflow-y-auto overscroll-contain"
            >
              <Container className="flex flex-col py-2">
                {links.map((link, index) => (
                  <motion.a
                    key={link.id}
                    href={`#${link.id}`}
                    onClick={() => setMenuOpen(false)}
                    initial={calm ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.04 * index, ease: EASE }}
                    className={[
                      'font-display flex min-h-16 items-center justify-between gap-4 border-b border-hairline',
                      'text-lg font-semibold tracking-[-0.02em] outline-none',
                      'focus-visible:ring-4 focus-visible:ring-ring/25',
                      activeSection === link.id ? 'text-primary' : 'text-foreground',
                    ].join(' ')}
                  >
                    {link.label}
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </motion.a>
                ))}
              </Container>
            </nav>

            {/* Нижний блок: язык и главное действие. pb с safe-area — иначе на айфоне
                кнопка уезжает под системную полосу жеста. */}
            <Container className="flex flex-col gap-4 border-t border-hairline py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
                  {dict.footer.language}
                </span>
                <LanguageMenu current={locale} />
              </div>
              <LinkButton href={mailto} external className="w-full">
                {dict.nav.demo}
              </LinkButton>
            </Container>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="sh-header z-50 border-b border-hairline bg-background/70 backdrop-blur-xl">
        <Container className="sh-header__bar flex items-center justify-between gap-2 sm:gap-4">
          {/* items-center на строке и на самой ссылке: иконка выше строчных букв, и без
            общего центрирования логотип оптически выпадает вверх. */}
          <a
            href={localePath(locale)}
            className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
          >
            <GraduationCap className="size-6 shrink-0 text-primary" aria-hidden />
            <span className="font-display text-[0.9375rem] leading-none font-semibold tracking-[-0.02em] sm:text-base">
              StudentHub
            </span>
          </a>

          <nav className="hidden items-center gap-1 lg:flex" aria-label={dict.nav.product}>
            {links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                aria-current={activeSection === link.id ? 'true' : undefined}
                className={[
                  'relative rounded-md px-3 py-2 text-sm outline-none',
                  'hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20',
                  activeSection === link.id ? 'text-foreground' : 'text-foreground/60',
                ].join(' ')}
              >
                {link.label}
                {/* Подчёркивание активного раздела — тем же синим, что и везде. */}
                <span
                  aria-hidden
                  className={[
                    'absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-primary transition-opacity duration-200 motion-reduce:transition-none',
                    activeSection === link.id ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                />
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="hidden sm:block">
              <LanguageMenu current={locale} />
            </div>

            {/* Разделитель: без него язык и «Войти» читаются как одна группа кнопок. */}
            <span aria-hidden className="hidden h-5 w-px bg-hairline sm:block" />

            {/* Второй CTA — тихий: один призыв на всю шапку недоиспользует место, но и
              спорить с «Войти» он не должен. */}
            {/*
            Прятать обёрткой, а не классом `hidden` на самой кнопке: `hidden` и базовый
            `inline-flex` — утилиты одного свойства, и кто из них победит, решает порядок
            в сгенерированном CSS, а не порядок в строке класса. На узком экране кнопка
            оставалась видимой и выдавливала бургер за край.
          */}
            <span className="hidden xl:block">
              <LinkButton
                href={mailto}
                external
                variant="ghost"
                size="sm"
                className="text-foreground/70 hover:text-foreground"
              >
                {dict.nav.demo}
              </LinkButton>
            </span>

            <LinkButton href={PLATFORM_LINKS.login} external size="sm">
              {dict.nav.login}
            </LinkButton>

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              aria-label={menuOpen ? dict.nav.close : dict.nav.menu}
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-hairline bg-surface text-foreground/70 outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/25 lg:hidden"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </Container>
      </header>
    </>
  )
}
