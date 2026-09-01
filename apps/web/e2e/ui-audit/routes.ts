import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../support/test-env.cjs'
import { ACCOUNTS } from '../support/sign-in'

// Реестр экранов для UI-аудита.
//
// Маршруты НЕ перечисляются руками. Их около ста тридцати, и появляются они каждую неделю:
// рукописный список устаревает молча, а аудит после этого «зеленеет» просто потому, что новых
// экранов в нём нет — худший вид ложного спокойствия. Поэтому источник истины — файловая
// система App Router (src/app/**/page.tsx), а руками задаётся только политика: кто открывает
// зону и что осознанно не проверяется (и почему).

const APP_DIR = join(REPO_ROOT, 'apps/web/src/app')

/** Кто открывает экран: ключ посевного аккаунта из sign-in.ts либо гость. */
export type Audience = 'public' | keyof typeof ACCOUNTS

export interface AuditRoute {
  /** Путь, который открывает браузер. */
  url: string
  /** Файл-источник — чтобы из отчёта было куда идти править. */
  source: string
  audience: Audience
  /** Причина пропуска. Заполнена — маршрут в прогон не идёт, но в отчёте виден. */
  skip?: string
  /**
   * Как достать значение динамического сегмента: открыть страницу-список и взять первую
   * подходящую ссылку. Придумывать id самостоятельно нельзя — «страницы, требующие данных,
   * без понимания зависимостей» дают ложные 404 вместо находок.
   */
  discover?: { from: string; linkPrefix: string }
}

/**
 * Публичные пути — зеркало PUBLIC_PATHS из src/middleware.ts.
 *
 * Импортировать оттуда нельзя: модуль тянет next/server и рассчитан на runtime Next.
 * При правке списка в middleware поправить и здесь — иначе аудит попытается открыть
 * публичный экран из-под роли и получит редирект на её домашнюю страницу.
 */
const PUBLIC_PREFIXES = ['/login', '/register', '/offline', '/employer/signup', '/employer/verify']

/**
 * Зона → аккаунт. Порядок важен: проверяется первое совпадение по префиксу, поэтому
 * `/moderator/platform` обязан стоять раньше `/moderator`.
 */
const ZONE_AUDIENCE: Array<[prefix: string, audience: Audience]> = [
  ['/platform-admin', 'platformAdmin'],
  ['/moderator/platform', 'platformModerator'],
  ['/moderator/university', 'universityModerator'],
  ['/university-admin', 'universityAdmin'],
  ['/dean', 'dean'],
  ['/teacher', 'teacher'],
  ['/starosta', 'starosta'],
]

/** Маршруты, которые не проверяем, и честная причина для отчёта. */
const SKIPS: Array<[match: (url: string) => boolean, reason: string]> = [
  [
    (url) => url.startsWith('/employer'),
    'нет посевного аккаунта EMPLOYER: его создаёт seed-career.mjs, а e2e-стенд запускает только seed.mjs',
  ],
  [
    (url) => url === '/notifications',
    'by design редиректит на / (уведомления живут оверлеем сайдбара) — проверять нечего',
  ],
  [
    (url) => url.includes('[...'),
    'catch-all рендерит заглушку «раздел в разработке»; конкретные вкладки секции проверяются отдельно',
  ],
  [
    (url) => url.startsWith('/r/') || url === '/join-chat',
    'экран по внешней ссылке (QR помещения, приглашение в чат) — нужен валидный код, иначе проверяется не экран, а страница ошибки',
  ],
]

/**
 * Динамические маршруты, для которых значение сегмента можно честно достать из приложения.
 * Остальные помечаются пропуском: выдуманный id проверяет экран «не найдено», а не экран.
 */
const DISCOVERABLE: Record<string, { from: string; linkPrefix: string }> = {
  '/courses/[subject]': { from: '/courses', linkPrefix: '/courses/' },
  '/posts/[id]': { from: '/', linkPrefix: '/posts/' },
  '/profile/[id]': { from: '/', linkPrefix: '/profile/' },
}

/** Каталоги внутри src/app, куда ходить незачем. */
function isIgnoredSegment(name: string): boolean {
  // @slot — параллельные роуты, они рендерятся внутри родителя и своего URL не имеют.
  return name.startsWith('_') || name.startsWith('@') || name === 'api'
}

/** Сегмент группы `(auth)` в URL не попадает. */
function isRouteGroup(name: string): boolean {
  return name.startsWith('(') && name.endsWith(')')
}

interface DiscoveredPage {
  url: string
  source: string
}

function walk(dir: string, segments: string[], found: DiscoveredPage[]): void {
  const entries = readdirSync(dir, { withFileTypes: true })

  if (entries.some((e) => e.isFile() && e.name === 'page.tsx')) {
    const url = segments.length > 0 ? `/${segments.join('/')}` : '/'
    found.push({ url, source: `src/app${dir.slice(APP_DIR.length)}/page.tsx` })
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || isIgnoredSegment(entry.name)) continue
    const next = isRouteGroup(entry.name)
      ? segments
      : // Каталог «/_dev» в App Router пришлось бы назвать %5Fdev: подчёркивание в начале
        // означает приватную папку вне роутинга. В URL он снова обычный «_dev».
        [...segments, decodeURIComponent(entry.name)]
    walk(join(dir, entry.name), next, found)
  }
}

function audienceFor(url: string): Audience {
  if (PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`))) return 'public'
  const zone = ZONE_AUDIENCE.find(([prefix]) => url === prefix || url.startsWith(`${prefix}/`))
  // Всё, что не попало в ролевую зону, — общая часть приложения: лента, чаты, расписание,
  // профиль, витрина дизайн-системы. Её домашняя роль — студент (ROLE_HOME[STUDENT] === '/').
  return zone ? zone[1] : 'student'
}

function skipReason(url: string): string | undefined {
  const hit = SKIPS.find(([match]) => match(url))
  if (hit) return hit[1]
  if (url.includes('[')) {
    return DISCOVERABLE[url]
      ? undefined
      : 'динамический сегмент: подставить id наугад — значит проверить экран «не найдено»'
  }
  return undefined
}

/** Все страницы App Router с проставленной политикой доступа. */
export function discoverRoutes(): AuditRoute[] {
  const found: DiscoveredPage[] = []
  walk(APP_DIR, [], found)

  return found
    .map(({ url, source }) => {
      const route: AuditRoute = { url, source, audience: audienceFor(url) }
      const skip = skipReason(url)
      if (skip) route.skip = skip
      const discover = DISCOVERABLE[url]
      if (discover) route.discover = discover
      return route
    })
    .sort((a, b) => a.url.localeCompare(b.url))
}
