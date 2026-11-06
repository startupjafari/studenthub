import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import type { Browser, Page } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { ACCOUNTS, signIn } from './support/sign-in'
import { trackTokenRotation } from './support/token-rotation'
import {
  AXE_ALLOWLIST,
  findAllowance,
  routeMatches,
  type AxeAllowance,
  type AxeFinding,
} from './support/axe-allowlist'
import { discoverRoutes, resolveDynamic, type Audience } from './ui-audit/routes'
import { attachMonitor, waitForQuiet, type PageMonitor } from './ui-audit/support/page-monitor'

// axe на ВСЕХ экранах всех ролей (план 13.7, решение владельца: «проверять axe все экраны»).
//
// Раньше axe смотрел пять студенческих маршрутов, а экраны сотрудников — только на
// горизонтальную прокрутку (a11y.e2e.ts). Теперь перечень экранов берётся из того же реестра,
// что у UI-аудита (e2e/ui-audit/routes.ts): он строится по файловой системе App Router, поэтому
// новый экран попадает под проверку сам, без правки этого файла. Политика «кто открывает
// зону и что не проверяется» — там же, одна на оба обхода.
//
// ЧТО ВАЛИТ ТЕСТ. Нарушения WCAG 2.1 A/AA уровня serious и critical, кроме явно перечисленных
// в support/axe-allowlist.ts (там у каждой записи причина и что чинить). minor и moderate
// идут в отчёт и сводку CI, но тест не роняют: это очередь на улучшение.
//
// КАКИЕ РОЛИ НЕ ПРОВЕРЯЮТСЯ. Только EMPLOYER: фикстура e2e работодателя не заводит — у него
// нужна одобренная вузом компания, а компаний и вакансий на стенде нет. Его экраны (кроме
// публичной регистрации /employer/signup) реестр помечает пропуском с этой причиной. Остальные
// десять ролей фикстуры (prisma/e2e-fixture.mjs) обходятся каждая своим входом.
//
// БЮДЖЕТ ВХОДОВ. Входов здесь десять, а POST /auth/login ограничен пятью за 15 минут с IP.
// На стенде лимит снят штатным THROTTLE_DISABLED (playwright.config.ts) — см. sign-in.ts.
//
// ШИРИНА. Все экраны — на мобильной (375 px): мобильный сценарий основной (FRONTEND_RULES §9),
// и критерий релиза по Lighthouse тоже мобильный. Каркас на десктопе другой (сайдбар вместо
// нижней навигации), поэтому домашний экран каждой зоны проверяется ещё и на 1280 px — сам
// каркас у всех экранов зоны общий, повторять десктоп на каждом незачем.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const BLOCKING_IMPACTS = new Set(['serious', 'critical'])

const MOBILE = { width: 375, height: 812 }
const DESKTOP = { width: 1280, height: 800 }

/** Куда пишется отчёт: по файлу на зону — повтор упавшей зоны не затирает остальные. */
const REPORT_DIR = path.resolve(process.cwd(), 'a11y-axe')

const ALL_ROUTES = discoverRoutes()

/** Публичная зона первой; дальше — каждая роль фикстуры, для которой есть аккаунт. */
const ZONES: Audience[] = ['public', ...(Object.keys(ACCOUNTS) as Array<keyof typeof ACCOUNTS>)]

interface ZoneReport {
  zone: Audience
  findings: AxeFinding[]
  /** Экраны, которые реестр не проверяет, и почему. */
  skipped: Record<string, string>
  /** Экраны, где открылся другой адрес: axe по ним не гонялся, иначе находки ушли бы не туда. */
  redirected: Record<string, string>
  /** Что реально проверено (с подставленными id динамических сегментов). */
  checked: string[]
  /** Записи allowlist для экранов зоны, которым не нашлось нарушения: починено — пора удалить. */
  staleAllowances: AxeAllowance[]
}

async function settle(page: Page, monitor: PageMonitor): Promise<void> {
  // У публичных экранов <main> может не быть — ждём его, но не требуем.
  await page
    .getByRole('main')
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => undefined)
  // Скелетон вместо данных — не тот экран, который видит пользователь: ждём затишья сети.
  await waitForQuiet(monitor)
}

async function analyze(
  page: Page,
  zone: Audience,
  route: string,
  viewport: 'mobile' | 'desktop',
  used: Set<AxeAllowance>,
): Promise<AxeFinding[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.map((violation) => {
    const finding: AxeFinding = {
      zone,
      route,
      viewport,
      rule: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      elements: violation.nodes.length,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }
    const allowance = findAllowance(finding)
    if (allowance) {
      finding.allowed = allowance.reason
      used.add(allowance)
    }
    return finding
  })
}

async function auditZone(browser: Browser, zone: Audience): Promise<ZoneReport> {
  const report: ZoneReport = {
    zone,
    findings: [],
    skipped: {},
    redirected: {},
    checked: [],
    staleAllowances: [],
  }
  const used = new Set<AxeAllowance>()
  const routes = ALL_ROUTES.filter((r) => r.audience === zone)

  const context = await browser.newContext({ viewport: MOBILE, locale: 'ru-RU' })
  const page = await context.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const monitor = attachMonitor(page)
  const rotationSettled = trackTokenRotation(page)

  try {
    if (zone !== 'public') {
      await signIn(page, zone)
      await rotationSettled()
    }

    let home: string | null = null
    for (const route of routes) {
      if (route.skip !== undefined) {
        report.skipped[route.url] = route.skip
        continue
      }
      let url = route.url
      if (route.discover !== undefined) {
        await rotationSettled()
        const resolved = await resolveDynamic(page, route)
        if (resolved === null) {
          report.skipped[route.url] =
            `не нашлось ссылки ${route.discover.linkPrefix}* на ${route.discover.from} — id наугад не подставляем`
          continue
        }
        url = resolved
      }

      await test.step(`${zone} ${url}`, async () => {
        // Уход со страницы посреди ротации refresh-токена гасит сессию (token-rotation.ts).
        await rotationSettled()
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await settle(page, monitor)
        monitor.drain()

        const landed = new URL(page.url()).pathname
        if (landed !== new URL(url, 'http://x').pathname) {
          report.redirected[url] = landed
          return
        }
        home ??= url
        report.checked.push(url)
        report.findings.push(...(await analyze(page, zone, url, 'mobile', used)))
      })
    }

    if (home !== null) {
      const desktopHome = home
      await test.step(`${zone} ${desktopHome} — десктоп`, async () => {
        await page.setViewportSize(DESKTOP)
        await rotationSettled()
        await page.goto(desktopHome, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await settle(page, monitor)
        report.findings.push(...(await analyze(page, zone, desktopHome, 'desktop', used)))
      })
    }
  } finally {
    await rotationSettled()
    await context.close()
  }

  report.staleAllowances = AXE_ALLOWLIST.filter(
    (a) =>
      !used.has(a) &&
      (a.zone === undefined || a.zone === zone) &&
      report.checked.some((route) => a.routes.some((pattern) => routeMatches(pattern, route))),
  )
  return report
}

for (const zone of ZONES) {
  test(`axe: все экраны зоны ${zone} без нарушений serious/critical`, async ({
    browser,
  }, testInfo) => {
    const count = ALL_ROUTES.filter((r) => r.audience === zone && r.skip === undefined).length
    test.skip(count === 0, `в реестре нет экранов зоны ${zone}`)
    // Экран — переход, ожидание данных и прогон axe: до полуминуты на медленном раннере.
    test.setTimeout(120_000 + count * 30_000)

    const report = await auditZone(browser, zone)

    // В отчёт Playwright — под рукой при разборе падения; в файл — для сводки прогона в CI.
    const body = JSON.stringify(report, null, 2)
    await testInfo.attach(`axe-${zone}.json`, { body, contentType: 'application/json' })
    await mkdir(REPORT_DIR, { recursive: true })
    await writeFile(path.join(REPORT_DIR, `${zone}.json`), body, 'utf8')

    // Устаревшую запись allowlist не роняем (часть находок зависит от данных стенда), но
    // показываем: иначе починенное так и висело бы в списке «терпимого».
    for (const stale of report.staleAllowances) {
      testInfo.annotations.push({
        type: 'axe-allowlist',
        description: `запись ${stale.rule} (${stale.routes.join(', ')}) не сработала — починено? удалить`,
      })
    }

    // Выброс на вход = потерянная сессия: дальше по зоне axe проверял бы форму входа.
    const lostSession = Object.entries(report.redirected).filter(([, to]) => to === '/login')
    expect(lostSession, 'зона выброшена на /login — экраны не проверены').toEqual([])

    const blocking = report.findings
      .filter((f) => BLOCKING_IMPACTS.has(f.impact) && f.allowed === undefined)
      .map((f) => `${f.route} [${f.viewport}] ${f.rule} (${f.impact}, ${f.elements}): ${f.help}`)
    expect(blocking, 'нарушения WCAG уровня serious/critical вне allowlist').toEqual([])
  })
}
