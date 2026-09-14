import type { Locale } from '../config/site'
import { getDictionary } from '../content'
import { SiteHeader } from './site-header'
import { Hero } from './hero'
import { Doors } from './doors'
import { Day } from './day'
import { Roles } from './roles'
import { Security } from './security'
import { Rollout } from './rollout'
import { Scale } from './scale'
import { Faq } from './faq'
import { Cta } from './cta'
import { SiteFooter } from './site-footer'
import { StructuredData } from './structured-data'
import { ProgressBar, SiteMotion } from './site-motion'

/**
 * Композиция страницы. Одна и та же для всех языков — различается только словарь.
 *
 * Порядок секций не случаен: сначала действие (первый экран и три двери), потом
 * объяснение продукта (день, роли), потом доверие (безопасность, внедрение, масштаб),
 * и только в конце — вопросы и заявка. Человек, пришедший войти, не должен пролистывать
 * маркетинг, чтобы найти кнопку.
 */
export function LandingPage({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale)

  return (
    <>
      <StructuredData dict={dict} locale={locale} />
      <ProgressBar />
      {/* Один наблюдатель на страницу: появление блоков, счётчики, индикатор, шапка. */}
      <SiteMotion />
      <SiteHeader dict={dict} locale={locale} />
      <main>
        <Hero dict={dict} />
        <Doors dict={dict} />
        <Day dict={dict} />
        <Roles dict={dict} />
        <Security dict={dict} />
        <Rollout dict={dict} />
        <Scale dict={dict} />
        <Faq dict={dict} />
        <Cta dict={dict} />
      </main>
      <SiteFooter dict={dict} locale={locale} />
    </>
  )
}
