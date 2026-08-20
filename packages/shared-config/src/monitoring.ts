// Наблюдаемость: что НЕЛЬЗЯ отправлять во внешний трекер ошибок (Sentry).
// Единый источник для api (@sentry/nestjs) и web (@sentry/nextjs): оба приложения
// прогоняют события через одинаковые правила — правило, добавленное здесь,
// начинает действовать в обоих. Список — расширение §13/§14 (что не логируем)
// на внешний SaaS: pino-redact защищает наши логи, это — чужие.

/**
 * Query-параметры, значение которых является учётными данными или персональными
 * данными. В URL встречаются: `?token=` (ссылка-приглашение, QR студенческого),
 * `?code=` (код 2FA).
 */
export const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  'token',
  'code',
  'password',
  'secret',
  'key',
  'signature',
  // Presigned-ссылки MinIO/S3 (подпись в query).
  'X-Amz-Signature',
  'X-Amz-Credential',
]

/** Заголовки, которые не должны покидать периметр (дубль pino-redact, §13). */
export const SENSITIVE_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-refresh-token',
]

/**
 * Пути, где секрет лежит в самом сегменте URL, а не в query.
 * `GET /invites/:token/preview` — токен инвайта = одноразовый пароль на регистрацию.
 */
const SENSITIVE_PATH_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /\/invites\/[^/?#]+\/preview/gi, replacement: '/invites/[token]/preview' },
]

const REDACTED = '[Filtered]'

/**
 * Убирает из URL секреты: значения чувствительных query-параметров заменяет на
 * `[Filtered]`, секретные сегменты пути — на placeholder. Структура URL сохраняется,
 * чтобы события всё ещё группировались по эндпоинту.
 *
 * Работает и с относительными URL (`/register?token=…` — так их отдаёт Fastify),
 * и с абсолютными (так их пишет браузер). Невалидный URL возвращается как есть,
 * но только если в нём нет ничего похожего на секрет — иначе строка отбрасывается.
 */
export function scrubUrl(url: string): string {
  const [rawPath = '', ...rest] = url.split('?')
  const query = rest.join('?')

  let path = rawPath
  for (const { pattern, replacement } of SENSITIVE_PATH_PATTERNS) {
    path = path.replace(pattern, replacement)
  }

  if (!query) {
    return path
  }

  // Сравнение без учёта регистра: `?Token=` — тот же секрет.
  const sensitive = new Set(SENSITIVE_QUERY_PARAMS.map((p) => p.toLowerCase()))
  const scrubbedQuery = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq === -1) {
        return pair
      }
      const name = pair.slice(0, eq)
      return sensitive.has(name.toLowerCase()) ? `${name}=${REDACTED}` : pair
    })
    .join('&')

  return `${path}?${scrubbedQuery}`
}

/**
 * Удаляет чувствительные заголовки из словаря (регистр значения не важен —
 * HTTP-заголовки case-insensitive, а Fastify и браузер отдают их по-разному).
 * Возвращает новый объект; исходный не мутируется.
 */
export function scrubHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers) {
    return headers
  }
  const blocked = new Set(SENSITIVE_HEADERS.map((h) => h.toLowerCase()))
  const result: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!blocked.has(name.toLowerCase())) {
      result[name] = value
    }
  }
  return result
}

/**
 * Минимальная структурная форма события Sentry — только те поля, которые мы чистим.
 * Описана здесь, а не импортирована из SDK, чтобы пакет остался без зависимостей
 * и годился и для Node-бэкенда (`@sentry/nestjs`), и для браузера (`@sentry/nextjs`).
 */
export interface ScrubbableRequest {
  url?: string
  query_string?: unknown
  data?: unknown
  cookies?: unknown
  headers?: Record<string, string>
}

export interface ScrubbableBreadcrumb {
  data?: Record<string, unknown>
}

// Индексных сигнатур здесь намеренно нет: с ними типы SDK (RequestEventData, Breadcrumb)
// перестают быть присваиваемыми, и весь смысл структурной совместимости теряется.
export interface ScrubbableEvent {
  transaction?: string
  request?: ScrubbableRequest
  breadcrumbs?: ScrubbableBreadcrumb[]
}

/**
 * Приводит событие к виду, который допустимо отправить во внешний трекер (§14.9, §11.3):
 *
 * - тело запроса и cookie вырезаются целиком — там ФИО, номера документов, текст сообщений;
 * - `Authorization`/`Cookie` вырезаются из заголовков (второй слой к `sendDefaultPii: false`);
 * - из URL, имени транзакции и хлебных крошек убираются секреты (`?token=`, `/invites/:token`).
 *
 * Общая реализация для api и web: правило, добавленное здесь, действует в обоих приложениях.
 * Тесты — `apps/api/src/common/monitoring/sentry-scrub.spec.ts` и
 * `apps/web/src/shared/lib/monitoring/sentry-options.test.ts`.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    const { data: _body, cookies: _cookies, ...request } = event.request
    event.request = {
      ...request,
      ...(typeof request.url === 'string' ? { url: scrubUrl(request.url) } : {}),
      ...(typeof request.query_string === 'string'
        ? { query_string: stripLeadingQuery(scrubUrl(`?${request.query_string}`)) }
        : {}),
      headers: scrubHeaders(request.headers) as Record<string, string> | undefined,
    }
  }

  // Имя транзакции идёт в заголовок issue и в поиск — секрет из пути попал бы и туда.
  if (typeof event.transaction === 'string') {
    event.transaction = scrubUrl(event.transaction)
  }

  // Хлебные крошки (fetch/xhr/навигация) содержат URL.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) =>
      crumb.data ? { ...crumb, data: scrubBreadcrumbData(crumb.data) } : crumb,
    )
  }

  return event
}

/**
 * Поля хлебной крошки, в которых лежит URL. `url` — у fetch/xhr, `from`/`to` — у крошки
 * навигации: именно её пропускала первая версия, и токен приглашения из `/register?token=…`
 * уезжал в трекер целиком (найдено прогоном реального SDK, а не ревью).
 */
const URL_BREADCRUMB_KEYS = ['url', 'from', 'to'] as const

/** Чистит все URL-поля данных хлебной крошки. Исходный объект не мутируется. */
export function scrubBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  let result = data
  for (const key of URL_BREADCRUMB_KEYS) {
    const value = result[key]
    if (typeof value === 'string') {
      result = { ...result, [key]: scrubUrl(value) }
    }
  }
  return result
}

function stripLeadingQuery(urlWithQuery: string): string {
  const index = urlWithQuery.indexOf('?')
  return index === -1 ? urlWithQuery : urlWithQuery.slice(index + 1)
}
