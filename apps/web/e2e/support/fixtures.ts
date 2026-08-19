import { test as base, type BrowserContext, type Page, type Request } from '@playwright/test'
import { signIn, type Role } from './sign-in'

/**
 * Ждать завершения ротации refresh-токена перед закрытием вкладки.
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
 */
function trackTokenRotation(page: Page): () => Promise<void> {
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

// Авторизованный контекст на воркер: логинимся один раз за прогон и переиспользуем ЖИВОЙ
// контекст браузера, а не сохранённый storageState.
//
// Почему не storageState. Refresh-токен одноразовый и ротируется при каждом обмене
// (docs/PROJECT.md §7.2): записанная в файл cookie гаснет после первого использования, и
// следующий контекст получает 401 на всех запросах. Коварство в том, что интерфейс при этом
// рендерится — role-cookie отдельная и живая, — поэтому выглядит как «пустые данные», а не
// как разлогин. В живом контексте ротация идёт естественно, как в настоящем браузере.
//
// Почему один раз, а не в каждом тесте: POST /auth/login ограничен 5 запросами на 15 минут
// с IP (§7.4), а отключать throttler запрещено (AGENTS.md).

function authenticated(role: Role) {
  return base.extend<{ page: Page }, { roleContext: BrowserContext }>({
    roleContext: [
      async ({ browser }, use) => {
        const context = await browser.newContext()
        const page = await context.newPage()
        const rotationSettled = trackTokenRotation(page)
        await signIn(page, role)
        await rotationSettled()
        await page.close()
        await use(context)
        await context.close()
      },
      { scope: 'worker' },
    ],
    // Каждому тесту — своя вкладка в общем авторизованном контексте.
    page: async ({ roleContext }, use) => {
      const page = await roleContext.newPage()
      const rotationSettled = trackTokenRotation(page)
      await use(page)
      await rotationSettled()
      await page.close()
    },
  })
}

export const studentTest = authenticated('student')
export const deanTest = authenticated('dean')
export { expect } from '@playwright/test'
