'use client'

import { useEffect, useState } from 'react'
import { GraduationCap, Menu, X } from 'lucide-react'
import type { Locale } from '../config/site'
import { PLATFORM_LINKS, SALES_EMAIL, localePath } from '../config/site'
import type { Dictionary } from '../content'
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
    <header className="sh-header z-50 border-b border-border/70 bg-background/75 backdrop-blur-xl">
      <Container className="sh-header__bar flex items-center justify-between gap-2 sm:gap-4">
        {/* items-center на строке и на самой ссылке: иконка выше строчных букв, и без
            общего центрирования логотип оптически выпадает вверх. */}
        <a
          href={localePath(locale)}
          className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-4 focus-visible:ring-ring/20"
        >
          <GraduationCap className="size-6 shrink-0 text-primary" aria-hidden />
          <span className="text-[0.9375rem] leading-none font-bold sm:text-base">StudentHub</span>
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
          <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />

          {/* Второй CTA — тихий: один призыв на всю шапку недоиспользует место, но и
              спорить с «Войти» он не должен. */}
          <LinkButton
            href={mailto}
            external
            variant="ghost"
            className="hidden h-9 px-3 text-[0.8125rem] text-foreground/70 hover:text-foreground xl:inline-flex"
          >
            {dict.nav.demo}
          </LinkButton>

          <LinkButton href={PLATFORM_LINKS.login} external className="h-9 px-4 text-[0.8125rem]">
            {dict.nav.login}
          </LinkButton>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? dict.nav.close : dict.nav.menu}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-foreground/70 outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/20 lg:hidden"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </Container>

      {/* Мобильное меню: разделы и язык. «Войти» из шапки не убирается — она нужна
          и при открытом меню. */}
      {menuOpen && (
        <div className="sh-swap border-t border-border bg-background/95 backdrop-blur-xl lg:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={() => setMenuOpen(false)}
                className={[
                  'rounded-xl px-3 py-3 text-sm font-medium outline-none',
                  'hover:bg-foreground/[0.06] focus-visible:ring-4 focus-visible:ring-ring/20',
                  activeSection === link.id ? 'bg-primary/10 text-primary' : 'text-foreground/80',
                ].join(' ')}
              >
                {link.label}
              </a>
            ))}

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
              <span className="px-3 text-xs tracking-wide text-foreground/60 uppercase">
                {dict.footer.language}
              </span>
              <LanguageMenu current={locale} />
            </div>

            <LinkButton href={mailto} external variant="secondary" className="mt-2 w-full">
              {dict.nav.demo}
            </LinkButton>
          </Container>
        </div>
      )}
    </header>
  )
}
