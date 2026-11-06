import type { Locale } from '../config/site'
import { getDictionary } from '../content'
import { SiteHeader } from './site-header'
import { Hero } from './hero'
import { Doors } from './doors'
import { Roles } from './roles'
import { Modules } from './modules'
import { Security } from './security'
import { Rollout } from './rollout'
import { Scale } from './scale'
import { Faq } from './faq'
import { Cta } from './cta'
import { SiteFooter } from './site-footer'
import { StructuredData } from './structured-data'
import { SiteMotion } from './site-motion'

/**
 * Композиция страницы. Одна и та же для всех языков — различается только словарь.
 *
 * Порядок секций не случаен: сначала действие (первый экран и три двери), потом
 * показ продукта (роли и модули), потом доверие (безопасность, внедрение, масштаб), и
 * только в конце — вопросы и заявка. Человек, пришедший войти, не должен пролистывать маркетинг,
 * чтобы найти кнопку.
 */
export function LandingPage({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale)

  return (
    <>
      <StructuredData dict={dict} locale={locale} />
      {/* Один наблюдатель на страницу: счётчики и поведение шапки. */}
      <SiteMotion />
      <SiteHeader dict={dict} locale={locale} />
      <main>
        {/*
          Фоны чередуются строго через один, и порядок задаётся здесь — в единственном
          месте, где видна вся последовательность. Секция, выбирающая тон сама, рано или
          поздно окажется одного цвета с соседней, и полосы перестанут читаться.

          Страница обрамлена двумя брендовыми полосами: первый экран и призыв. Между ними
          бренд не появляется — иначе цветных пятен становится столько, что ни одно из них
          уже ничего не выделяет.
        */}
        <Hero dict={dict} locale={locale} />
        <Doors dict={dict} locale={locale} tone="plain" />
        <Roles dict={dict} tone="muted" />
        {/*
          Модули — сразу за ролями, до «Безопасности»: это продолжение показа продукта
          (роли — учёба, модули — остальной кампус), и рассказ о защите должен начинаться,
          когда человек уже знает, что именно защищается. Поставь их после доверия — и
          страница вернётся к демонстрации, уже перейдя к аргументам.
        */}
        <Modules dict={dict} tone="plain" />
        <Security dict={dict} tone="muted" />
        <Rollout dict={dict} tone="plain" />
        <Scale dict={dict} tone="muted" />
        <Faq dict={dict} locale={locale} tone="plain" />
        <Cta dict={dict} locale={locale} />
      </main>
      <SiteFooter dict={dict} locale={locale} />
    </>
  )
}
