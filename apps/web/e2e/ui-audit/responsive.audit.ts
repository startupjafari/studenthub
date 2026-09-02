import { expect, test, type Browser, type Page } from '@playwright/test'
import { join } from 'node:path'
import { signIn } from '../support/sign-in'
import { trackTokenRotation } from '../support/token-rotation'
import { discoverRoutes, type Audience, type AuditRoute } from './routes'
import {
  FULL_PAGE_SHOTS,
  RELOAD_PER_VIEWPORT,
  REQUESTED_ROUTES,
  REQUESTED_VIEWPORTS,
  REQUESTED_ZONES,
  SEMANTIC_VIEWPORT,
  VIEWPORTS,
  VISUAL_REGRESSION,
} from './config'
import { inspectLayout, inspectSemantics, type RawFinding } from './support/page-checks'
import { attachMonitor, eventsToFindings, waitForQuiet } from './support/page-monitor'
import { FindingCollector, type Finding } from './support/findings'
import { routeSlug, SCREENSHOTS_DIR, writeReport } from './support/report'

// Автономный UI-аудит: каждая ролевая зона обходится своим браузерным контекстом, на каждом
// экране снимаются скриншоты семи ширин и собираются находки. Прогон НЕ падает на первой
// проблеме — он собирает всё, пишет отчёт и только потом проверяет порог: смысл аудита в
// полной картине, а тест, падающий на первом же экране, показывает одну проблему из сорока.
//
// Отношение к e2e/a11y.e2e.ts: там быстрый шлагбаум на пяти ключевых экранах, который гоняется
// в обычном прогоне и в CI. Здесь — широкая развёртка по всем экранам всех ролей, которая
// запускается отдельным проектом Playwright (`--project=ui-audit`) и не удлиняет обычный e2e.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101/api/v1'

const collector = new FindingCollector()

const ALL_ROUTES = discoverRoutes()

const viewports = VIEWPORTS.filter(
  (v) => REQUESTED_VIEWPORTS === null || REQUESTED_VIEWPORTS.includes(v.name),
)

/** Зоны в порядке, в котором их обходим: публичная первой — она не тратит бюджет входов. */
const ALL_ZONES: Audience[] = [
  'public',
  'student',
  'starosta',
  'teacher',
  'dean',
  'universityAdmin',
  'universityModerator',
  'platformAdmin',
  'platformModerator',
]

function routesFor(zone: Audience): AuditRoute[] {
  return ALL_ROUTES.filter(
    (r) => r.audience === zone && (REQUESTED_ROUTES === null || REQUESTED_ROUTES.includes(r.url)),
  )
}

/**
 * Отключаем анимации и переходы до первого кадра.
 *
 * Скриншот, снятый посреди анимации, отличается от прогона к прогону, и сравнивать такие
 * картинки бессмысленно. `addInitScript` ставит стиль на каждый документ контекста — в отличие
 * от `addStyleTag`, который пришлось бы вешать заново после каждой навигации.
 */
async function freezeMotion(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
      caret-color: transparent !important;
    }`
    const attach = (): void => {
      document.head.appendChild(style)
    }
    if (document.head) attach()
    else document.addEventListener('DOMContentLoaded', attach)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** Дождаться, пока экран действительно отрисовался, а не показывает скелетон. */
async function settle(page: Page, monitor: ReturnType<typeof attachMonitor>): Promise<void> {
  // Каркас приложения. У публичных экранов <main> может не быть — это не ошибка.
  await page
    .getByRole('main')
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined)
  await waitForQuiet(monitor)
}

function toFindings(raw: RawFinding[], zone: string, route: string, viewport?: string): Finding[] {
  return raw.map((f) => ({
    severity: f.severity,
    category: f.category,
    zone,
    route,
    ...(viewport === undefined ? {} : { viewport }),
    message: f.message,
    ...(f.selector === undefined ? {} : { selector: f.selector }),
    ...(f.snippet === undefined ? {} : { snippet: f.snippet }),
  }))
}

/**
 * Достать значение динамического сегмента из самого приложения: открыть страницу-список и
 * взять первую подходящую ссылку. Не нашли — экран пропускается с честной причиной, а не
 * проверяется по выдуманному id (это проверило бы страницу «не найдено»).
 */
async function resolveDynamic(page: Page, route: AuditRoute): Promise<string | null> {
  if (route.discover === undefined) return null
  const { from, linkPrefix } = route.discover
  try {
    await page.goto(from, { waitUntil: 'domcontentloaded' })
    const href = await page
      .locator(`a[href^="${linkPrefix}"]`)
      .first()
      .getAttribute('href', { timeout: 5_000 })
    return href
  } catch {
    return null
  }
}

async function auditRoute(
  page: Page,
  monitor: ReturnType<typeof attachMonitor>,
  zone: string,
  url: string,
): Promise<void> {
  const anonymous = zone === 'public'
  monitor.drain() // события предыдущего экрана к этому отношения не имеют

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  } catch (error) {
    collector.add({
      severity: 'CRITICAL',
      category: 'nav',
      zone,
      route: url,
      message: `экран не открылся: ${error instanceof Error ? error.message.slice(0, 200) : 'неизвестная ошибка'}`,
    })
    return
  }
  await settle(page, monitor)

  const landed = new URL(page.url()).pathname
  if (landed !== url) {
    // Выброс на вход означает потерянную сессию — с этого момента все дальнейшие находки
    // зоны недостоверны, поэтому уровень CRITICAL, а не «просто редирект».
    const lostSession = landed === '/login'
    collector.add({
      severity: lostSession ? 'CRITICAL' : 'MEDIUM',
      category: 'nav',
      zone,
      route: url,
      message: lostSession
        ? 'роль выброшена на /login — сессия потеряна или доступ к экрану закрыт'
        : `открылся другой адрес: ${landed} (проверить матрицу доступа docs/PROJECT.md)`,
    })
    if (lostSession) return
  }

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    if (RELOAD_PER_VIEWPORT) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await settle(page, monitor)
    } else {
      // Дать раскладке пересчитаться после ресайза: медиазапросы применяются мгновенно,
      // но зависящие от них измерения (виртуальные списки, графики) — на следующем кадре.
      await page.waitForTimeout(150)
      await waitForQuiet(monitor, { quietMs: 200, timeoutMs: 3_000 })
    }

    const shotPath = join(SCREENSHOTS_DIR, zone, routeSlug(url), `${viewport.name}.png`)
    await page.screenshot({ path: shotPath, fullPage: FULL_PAGE_SHOTS, animations: 'disabled' })

    if (VISUAL_REGRESSION) {
      try {
        await expect(page).toHaveScreenshot([zone, routeSlug(url), `${viewport.name}.png`], {
          animations: 'disabled',
          // Живые данные (даты, счётчики, аватары) дают неизбежный шум — сравнение должно
          // ловить съехавшую вёрстку, а не смену минуты на часах.
          maxDiffPixelRatio: 0.02,
        })
      } catch (error) {
        collector.add({
          severity: 'MEDIUM',
          category: 'visual',
          zone,
          route: url,
          viewport: viewport.name,
          message: `расхождение с эталоном: ${error instanceof Error ? error.message.slice(0, 200) : 'diff'}`,
        })
      }
    }

    const layout = await inspectLayout(page, viewport)
    collector.addMany(toFindings(layout.findings, zone, url, viewport.name))
    for (const [category, count] of Object.entries(layout.truncated)) {
      collector.noteTruncated(category, count)
    }

    if (viewport.name === SEMANTIC_VIEWPORT) {
      const semantics = await inspectSemantics(page)
      collector.addMany(toFindings(semantics.findings, zone, url))
      for (const [category, count] of Object.entries(semantics.truncated)) {
        collector.noteTruncated(category, count)
      }
    }
  }

  const snapshot = monitor.drain()
  collector.throttled += snapshot.throttled
  collector.addMany(
    toFindings(eventsToFindings(snapshot, { apiBase: API_BASE, anonymous }), zone, url),
  )
}

/**
 * Клавиатура: до навигации можно добраться табом, у сфокусированного элемента виден фокус.
 * Одна проверка на зону — обходить табом каждый экран из ста тридцати незачем, каркас общий.
 */
async function auditKeyboard(page: Page, zone: string, home: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(home, { waitUntil: 'domcontentloaded' }).catch(() => undefined)

  // У публичных экранов (вход, регистрация) каркаса приложения нет вовсе — требовать от них
  // навигацию бессмысленно. Проверяем тогда только видимость фокуса в порядке обхода.
  const hasNav = await page
    .locator('nav')
    .count()
    .then((n) => n > 0)
  let reachedNav = false
  let invisibleFocus: string | null = null
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab')
    const state = await page.evaluate(() => {
      const el = document.activeElement
      if (el === null || el === document.body) return null
      const style = getComputedStyle(el)
      const ring = style.boxShadow
      const outline = style.outlineStyle
      const outlineWidth = parseFloat(style.outlineWidth)
      const visible =
        (ring !== 'none' && ring !== '') ||
        (outline !== 'none' && !Number.isNaN(outlineWidth) && outlineWidth > 0)
      return {
        inNav: el.closest('nav') !== null,
        visible,
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
      }
    })
    if (state === null) continue
    if (!state.visible && invisibleFocus === null) invisibleFocus = `${state.tag} «${state.label}»`
    if (state.inNav) {
      reachedNav = true
      break
    }
  }

  if (hasNav && !reachedNav) {
    collector.add({
      severity: 'HIGH',
      category: 'a11y',
      zone,
      route: home,
      message: 'до навигации не добраться клавишей Tab за 25 нажатий',
    })
  }
  if (invisibleFocus !== null) {
    collector.add({
      severity: 'MEDIUM',
      category: 'a11y',
      zone,
      route: home,
      message: `у элемента в порядке обхода не видно фокуса: ${invisibleFocus}`,
    })
  }
}

async function auditZone(browser: Browser, zone: Audience): Promise<void> {
  const routes = routesFor(zone)
  const skipped: Record<string, string> = {}
  const checked: string[] = []

  const context = await browser.newContext()
  const page = await context.newPage()
  await freezeMotion(page)
  const monitor = attachMonitor(page)
  const rotationSettled = trackTokenRotation(page)

  try {
    if (zone !== 'public') {
      await signIn(page, zone)
      await rotationSettled()
    }

    for (const route of routes) {
      if (route.skip !== undefined) {
        skipped[route.url] = route.skip
        continue
      }
      let url = route.url
      if (route.discover !== undefined) {
        const resolved = await resolveDynamic(page, route)
        if (resolved === null) {
          skipped[route.url] =
            `не нашлось ни одной ссылки ${route.discover.linkPrefix}* на ${route.discover.from} — подставлять id наугад нельзя`
          continue
        }
        url = resolved
      }
      await test.step(`${zone} ${url}`, async () => {
        await auditRoute(page, monitor, zone, url)
      })
      checked.push(url)
    }

    const home = routes.find((r) => r.skip === undefined)?.url ?? '/'
    await test.step(`${zone}: клавиатура`, async () => {
      await auditKeyboard(page, zone, home)
    })
  } finally {
    collector.addZone({ zone, checked, skipped })
    await rotationSettled()
    await context.close()
  }
}

for (const zone of ALL_ZONES) {
  const active = REQUESTED_ZONES.includes(zone)
  test(`зона ${zone}`, async ({ browser }) => {
    test.skip(!active, `зона не входит в этот прогон (UI_AUDIT_ZONES=${REQUESTED_ZONES.join(',')})`)
    // Экранов в зоне до сорока, каждый — семь ширин со скриншотом: дефолтные 60 секунд
    // здесь не про что.
    test.setTimeout(25 * 60_000)
    await auditZone(browser, zone)
  })
}

// Шлагбаум прогона. Отдельным тестом и последним по объявлению: к этому моменту все зоны
// уже обойдены, а отчёт всё равно допишется в afterAll — даже если проверка ниже упадёт.
// Порог именно CRITICAL/HIGH: MEDIUM и LOW — очередь на улучшение, а не повод глушить прогон.
test('нет проблем уровня CRITICAL и HIGH', () => {
  const blocking = collector.blocking()
  const summary = blocking
    .slice(0, 20)
    .map((f) => `${f.severity} ${f.route} [${f.category}] ${f.message}`)
    .join('\n')
  expect(
    blocking.length,
    blocking.length === 0 ? '' : `блокирующих находок ${blocking.length}:\n${summary}`,
  ).toBe(0)
})

test.afterAll(() => {
  // Зоны вне прогона отмечаем явно: отчёт, умалчивающий о непроверенном, читается как
  // «всё в порядке», хотя половина приложения даже не открывалась.
  for (const zone of ALL_ZONES) {
    if (REQUESTED_ZONES.includes(zone)) continue
    collector.addZone({
      zone,
      checked: [],
      skipped: {},
      unavailable:
        'не входила в этот прогон — бюджет входов 5 / 15 мин с IP (docs/PROJECT.md §7.4)',
    })
  }
  collector.addZone({
    zone: 'employer',
    checked: [],
    skipped: {},
    unavailable:
      'нет посевного аккаунта EMPLOYER: его создаёт этап companies сида (SEED_SCALE=small и выше), а e2e-стенд гоняет профиль demo',
  })

  const outcome = writeReport(collector)
  // Единственный console в проекте, где он уместен: путь к отчёту нужен человеку и
  // автономному циклу сразу после прогона.
  // eslint-disable-next-line no-console
  console.log(
    `\nUI audit: ${outcome.status} · CRITICAL=${outcome.counts.CRITICAL} HIGH=${outcome.counts.HIGH} MEDIUM=${outcome.counts.MEDIUM} LOW=${outcome.counts.LOW}\n` +
      `Отчёт: ${outcome.markdownPath}\nДанные: ${outcome.jsonPath}\n`,
  )
})
