import type { Page, Request } from '@playwright/test'

/**
 * Ждать завершения ротации refresh-токена перед закрытием вкладки или уходом со страницы.
 *
 * Access-токен живёт только в памяти, поэтому КАЖДАЯ новая вкладка восстанавливает сессию через
 * `POST /auth/refresh`, а он одноразовый и ротирующийся (docs/PROJECT.md §7.2): ответ приносит новую
 * cookie, старый токен сервер гасит сразу. Закрыть вкладку в этот момент — значит оборвать ответ:
 * новая cookie до контекста не доедет, и следующая вкладка придёт с уже погашенным токеном.
 * Реюз-детектор расценит это как кражу и убьёт всю сессию («Сессия скомпрометирована»), после чего
 * каждый запрос получает 401. Внешне выглядит как пустые данные в произвольном тесте дальше по
 * прогону — падает не тот сценарий, который сломал сессию (так и было с feed.e2e.ts).
 *
 * Ждём именно ротацию, а не `networkidle`: приложение держит WS и периодические опросы, поэтому
 * полного затишья сети может не наступить вовсе.
 *
 * Живёт отдельным модулем, а не внутри fixtures.ts: UI-аудит (e2e/ui-audit) ходит по сотням
 * маршрутов своими контекстами и упирается ровно в ту же ловушку, а копия этой логики разъехалась
 * бы с оригиналом при первой же правке.
 */
export function trackTokenRotation(page: Page): () => Promise<void> {
  const isRefresh = (request: Request): boolean => request.url().includes('/auth/refresh')
  let inFlight = 0
  let lastSeenAt = 0
  page.on('request', (request) => {
    if (!isRefresh(request)) return
    inFlight += 1
    lastSeenAt = Date.now()
  })
  const settle = (request: Request): void => {
    if (!isRefresh(request)) return
    inFlight -= 1
    lastSeenAt = Date.now()
  }
  page.on('requestfinished', settle)
  page.on('requestfailed', settle)

  // Ждём не «сейчас ничего не летит», а затишья: обмен могут инициировать поздние повторы
  // React Query, и проверка в один момент времени попала бы в промежуток между ними.
  const QUIET_MS = 700

  return async () => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (inFlight === 0 && (lastSeenAt === 0 || Date.now() - lastSeenAt > QUIET_MS)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}
