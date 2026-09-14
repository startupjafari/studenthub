import { GraduationCap } from 'lucide-react'
import type { Locale } from '../config/site'
import { PLATFORM_LINKS } from '../config/site'
import type { Dictionary } from '../content'
import { Container } from './primitives'
import { LanguageMenu } from './language-menu'

export function SiteFooter({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const year = new Date().getFullYear()

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

          <nav className="flex flex-col gap-2 text-sm" aria-label={dict.nav.product}>
            <FooterLink href={PLATFORM_LINKS.login}>{dict.nav.login}</FooterLink>
            <FooterLink href={PLATFORM_LINKS.employerSignup}>{dict.doors.company.title}</FooterLink>
            <FooterLink href={PLATFORM_LINKS.verifyDocument}>{dict.doors.verify.title}</FooterLink>
          </nav>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {dict.footer.language}
            </span>
            <LanguageMenu current={locale} />
          </div>
        </div>

        {/*
          Политика конфиденциальности и пользовательское соглашение живут в платформе
          (apps/web, shared/ui/legal-links) и открываются там модальным окном — отдельных
          адресов у них нет. Ставить сюда ссылку в никуда хуже, чем не ставить её вовсе:
          публичные URL для юридических документов — отдельная задача, и она ещё не решена.
        */}
        <p className="text-xs text-muted-foreground">
          © {year} StudentHub. {dict.footer.rights}
        </p>
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
