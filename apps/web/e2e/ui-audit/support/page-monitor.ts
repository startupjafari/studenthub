import type { Page, Request } from '@playwright/test'
import type { RawFinding } from './page-checks'

// Сбор ошибок консоли и сети за время визита на экран.
//
// Главная забота здесь — не «поймать всё», а не наврать. Аудит открывает сотни страниц подряд,
// и любой ложный шаблон превращается в сотню строк отчёта, за которыми настоящая проблема
// уже не видна. Поэтому каждый фильтр ниже снабжён причиной, а не просто занесён в список.

export interface ConsoleEvent {
  kind: 'error' | 'warning' | 'pageerror'
  text: string
}

export interface NetworkEvent {
  url: string
  resourceType: string
  /** HTTP-статус либо null, если запрос не состоялся вовсе. */
  status: number | null
  failure?: string
}

export interface MonitorSnapshot {
  console: ConsoleEvent[]
  network: NetworkEvent[]
  /** 429 от throttler'а — след самого аудита, а не дефект (см. FindingCollector.throttled). */
  throttled: number
}

/** Шум среды разработки: к качеству интерфейса отношения не имеет. */
const CONSOLE_NOISE = [
  // Приглашение поставить расширение — печатает сам React в dev-сборке.
  /Download the React DevTools/i,
  // Служебные сообщения дев-сервера Next.
  /\[Fast Refresh\]/i,
  /webpack-hmr/i,
  // Sentry без DSN на стенде честно сообщает, что события никуда не полетят.
  /\[Sentry\]/i,
  /Sentry Logger/i,
  // Предупреждение браузера о сторонних cookie — политика браузера, не код приложения.
  /third-party cookie/i,
  // Node предупреждает о punycode из транзитивной зависимости.
  /DeprecationWarning: The `punycode` module/i,
  // Браузер дублирует в консоль каждый неуспешный подзапрос этой безадресной строкой.
  // Тот же запрос уже разобран слушателем ответов — с URL, типом ресурса и уровнем.
  // Без фильтра каждая сетевая находка считается дважды, причём копия из консоли
  // всегда HIGH и перебивает осмысленную классификацию оригинала.
  /^Failed to load resource: the server responded with a status of/i,
]

/** Запросы, чей неуспех на e2e-стенде ожидаем и о продукте ничего не говорит. */
const NETWORK_NOISE = [
  // Туннель Sentry (next.config tunnelRoute): DSN на стенде не настроен.
  /\/monitoring(\?|$)/,
  // Горячая перезагрузка дев-сервера: 404 на hot-update — обычная гонка при навигации.
  /hot-update\.(json|js)/,
  // Иконки PWA и прочая статика, которой в дев-сборке может не быть.
  /\/_next\/static\/development\//,
]

function isNoise(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

export interface PageMonitor {
  /** Забрать и очистить накопленное — вызывается после каждого экрана. */
  drain(): MonitorSnapshot
  /** Сколько HTTP-запросов сейчас в полёте: по нему ждём затишья перед скриншотом. */
  inFlight(): number
  /** Момент последней сетевой активности (Date.now()). */
  lastActivityAt(): number
}

/**
 * Сколько запрос может висеть, прежде чем перестанет считаться «в полёте».
 *
 * Дев-сервер Next держит открытым SSE-канал горячей перезагрузки, приложение — стрим
 * уведомлений: такие запросы не завершаются никогда, и счётчик «в полёте» без этого потолка
 * не обнуляется ни разу за прогон. Тогда waitForQuiet честно выбирает свой таймаут на каждой
 * ширине каждого экрана — двадцать секунд на экран вместо трёх, полтора часа вместо десяти
 * минут. Обычный запрос за пять секунд успевает завершиться, так что потолок отсекает только
 * долгоживущие соединения.
 */
const STALE_REQUEST_MS = 5_000

/** Соединения, которые по своей природе не завершаются, — в счётчик не берём вовсе. */
function isLongLived(url: string, resourceType: string): boolean {
  return (
    url.startsWith('ws') ||
    resourceType === 'websocket' ||
    resourceType === 'eventsource' ||
    url.includes('/socket.io/') ||
    url.includes('webpack-hmr')
  )
}

export function attachMonitor(page: Page): PageMonitor {
  let consoleEvents: ConsoleEvent[] = []
  let networkEvents: NetworkEvent[] = []
  let throttled = 0
  // Время старта каждого незавершённого запроса: по нему считается «в полёте» с учётом потолка.
  const inFlightSince = new Map<Request, number>()
  let lastActivity = Date.now()

  page.on('console', (msg) => {
    const type = msg.type()
    if (type !== 'error' && type !== 'warning') return
    const text = msg.text()
    if (isNoise(text, CONSOLE_NOISE)) return
    consoleEvents.push({ kind: type, text })
  })

  page.on('pageerror', (error) => {
    consoleEvents.push({ kind: 'pageerror', text: `${error.name}: ${error.message}` })
  })

  page.on('request', (request) => {
    if (isLongLived(request.url(), request.resourceType())) return
    inFlightSince.set(request, Date.now())
    lastActivity = Date.now()
  })

  const settle = (request: Request): void => {
    inFlightSince.delete(request)
    lastActivity = Date.now()
  }

  page.on('requestfinished', (request) => {
    if (isLongLived(request.url(), request.resourceType())) return
    settle(request)
  })

  page.on('requestfailed', (request) => {
    if (isLongLived(request.url(), request.resourceType())) return
    settle(request)
    const failure = request.failure()?.errorText ?? 'неизвестная ошибка'
    // Уход со страницы обрывает всё, что не успело долететь. Это нормальная работа браузера,
    // а не сбой: без этого фильтра каждый переход между экранами давал бы ложную находку.
    if (failure.includes('ERR_ABORTED')) return
    if (isNoise(request.url(), NETWORK_NOISE)) return
    networkEvents.push({
      url: request.url(),
      resourceType: request.resourceType(),
      status: null,
      failure,
    })
  })

  page.on('response', (response) => {
    const status = response.status()
    if (status < 400) return
    const url = response.url()
    if (isNoise(url, NETWORK_NOISE)) return
    if (status === 429) {
      throttled += 1
      return
    }
    networkEvents.push({
      url,
      resourceType: response.request().resourceType(),
      status,
    })
  })

  return {
    drain() {
      const snapshot: MonitorSnapshot = {
        console: consoleEvents,
        network: networkEvents,
        throttled,
      }
      consoleEvents = []
      networkEvents = []
      throttled = 0
      return snapshot
    },
    inFlight() {
      const now = Date.now()
      let fresh = 0
      for (const [request, startedAt] of inFlightSince) {
        if (now - startedAt > STALE_REQUEST_MS) {
          // Больше не ждём его и не держим ссылку на Request: за прогон таких набегают сотни.
          inFlightSince.delete(request)
          continue
        }
        fresh += 1
      }
      return fresh
    },
    lastActivityAt: () => lastActivity,
  }
}

/** Ресурсы, без которых страница физически не может выглядеть правильно. */
const CRITICAL_RESOURCES = ['script', 'stylesheet', 'font', 'image']

export interface ClassifyContext {
  /** Базовый URL API — чтобы в отчёте были короткие пути, а не полные адреса. */
  apiBase: string
  /**
   * Экран открыт без сессии (публичная зона).
   *
   * Тогда 401 на `/auth/*` — не сбой, а штатный холодный старт: access-токен живёт только
   * в памяти, и приложение первым делом пробует обменять refresh-cookie, которой у гостя
   * нет (разбор случая — в apps/web/src/shared/api/auth-retry.ts). Считать это дефектом
   * значит записывать в отчёт по находке на каждый публичный экран.
   */
  anonymous: boolean
}

/** Перевод собранных событий в находки с классификацией. */
export function eventsToFindings(
  snapshot: MonitorSnapshot,
  { apiBase, anonymous }: ClassifyContext,
): RawFinding[] {
  const findings: RawFinding[] = []

  for (const event of snapshot.console) {
    if (event.kind === 'pageerror') {
      // Непойманное исключение означает, что кусок интерфейса не отрисовался или перестал
      // реагировать. Это всегда сломанный экран, даже если внешне он выглядит целым.
      findings.push({
        category: 'console',
        severity: 'CRITICAL',
        message: `непойманное исключение: ${event.text.slice(0, 300)}`,
      })
      continue
    }
    const isHydration = /hydrat/i.test(event.text)
    findings.push({
      category: 'console',
      severity: event.kind === 'error' ? 'HIGH' : 'LOW',
      message: isHydration
        ? `расхождение серверной и клиентской разметки (hydration): ${event.text.slice(0, 300)}`
        : `console.${event.kind}: ${event.text.slice(0, 300)}`,
    })
  }

  for (const event of snapshot.network) {
    const short = event.url.replace(apiBase, '').slice(0, 160)
    if (event.status === null) {
      findings.push({
        category: 'network',
        severity: CRITICAL_RESOURCES.includes(event.resourceType) ? 'HIGH' : 'MEDIUM',
        message: `запрос не выполнен (${event.failure}): ${event.resourceType} ${short}`,
      })
      continue
    }
    if (CRITICAL_RESOURCES.includes(event.resourceType)) {
      // Не загрузился шрифт, картинка или скрипт — экран выглядит не так, как задуман.
      findings.push({
        category: 'network',
        severity: 'HIGH',
        message: `ресурс не загрузился (${event.status}): ${event.resourceType} ${short}`,
      })
      continue
    }
    if (event.status >= 500) {
      findings.push({
        category: 'network',
        severity: 'HIGH',
        message: `сервер ответил ${event.status}: ${short}`,
      })
      continue
    }
    if (anonymous && event.status === 401 && /\/auth\//.test(event.url)) continue
    // 4xx на API не всегда дефект интерфейса: 403 на чужом маршруте и 404 отсутствующей
    // записи — штатная бизнес-логика (docs/PROJECT.md). Поэтому MEDIUM и разбор глазами,
    // а не автоматический провал прогона.
    findings.push({
      category: 'network',
      severity: 'MEDIUM',
      message: `запрос завершился ${event.status} — проверить, ожидаем ли он на этом экране: ${short}`,
    })
  }

  return findings
}

/**
 * Дождаться затишья сети.
 *
 * `networkidle` тут не годится: приложение держит WS-соединение и периодические опросы,
 * поэтому полного затишья по мнению Playwright может не наступить никогда (то же наблюдение
 * записано в e2e/support/token-rotation.ts). Ждём своё: нет запросов в полёте и с последней
 * активности прошло QUIET_MS.
 */
export async function waitForQuiet(
  monitor: PageMonitor,
  { quietMs = 400, timeoutMs = 8_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (monitor.inFlight() <= 0 && Date.now() - monitor.lastActivityAt() > quietMs) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
