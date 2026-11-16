import { GraduationCap } from 'lucide-react'
import type { Locale } from '../config/site'
import { SALES_EMAIL, platformLinks } from '../config/site'
import type { Dictionary } from '../content'
import { Container } from './primitives'
import { LanguageMenu } from './language-menu'

/**
 * Подвал: переключатель языка, вход, дверь работодателя, почта для связи и юридические
 * документы.
 */
export function SiteFooter({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const year = new Date().getFullYear()
  const links = platformLinks(locale)
  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(dict.cta.mailSubject)}`

  return (
    <footer className="border-t border-hairline py-14">
      <Container className="flex flex-col gap-8">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div className="flex max-w-sm flex-col gap-3">
            <span className="flex items-center gap-2">
              <GraduationCap className="size-5 text-primary" aria-hidden />
              <span className="text-sm font-bold">StudentHub</span>
            </span>
            <p className="text-sm leading-relaxed text-muted-foreground">{dict.footer.tagline}</p>
          </div>

          <nav className="flex flex-col gap-2 text-sm" aria-label={dict.footer.links}>
            <FooterLink href={links.login}>{dict.nav.login}</FooterLink>
            <FooterLink href={links.employerSignup}>{dict.footer.company}</FooterLink>
            {/* Почта показана целиком, а не спрятана под словом «Контакты»: её копируют
                глазами чаще, чем нажимают. */}
            <FooterLink href={mailto}>{SALES_EMAIL}</FooterLink>
          </nav>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {dict.footer.language}
            </span>
            <LanguageMenu current={locale} label={dict.footer.language} />
          </div>
        </div>

        {/*
          Политика и соглашение — публичные страницы платформы (/legal/privacy,
          /legal/terms): документы одни на сайт и продукт, и держать вторую копию текста
          здесь значило бы рано или поздно разойтись с редакцией, которую человек принимает
          при регистрации. Стоят в строке копирайта мелким текстом: их ищут целенаправленно,
          а не читают по пути.
        */}
        <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} StudentHub. {dict.footer.rights}
          </p>
          <nav aria-label={dict.footer.legal} className="flex flex-wrap gap-x-5 gap-y-2">
            <FooterLink href={links.privacy}>{dict.footer.privacy}</FooterLink>
            <FooterLink href={links.terms}>{dict.footer.terms}</FooterLink>
          </nav>
        </div>
      </Container>
    </footer>
  )
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      rel="noopener"
      className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
    </a>
  )
}
