import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { signIn, type Role } from './sign-in'
import { trackTokenRotation } from './token-rotation'

// Авторизованные контексты: логинимся по одному разу на роль за весь прогон и переиспользуем
// ЖИВЫЕ контексты браузера, а не сохранённый storageState.
//
// Почему не storageState. Refresh-токен одноразовый и ротируется при каждом обмене
// (docs/PROJECT.md §7.2): записанная в файл cookie гаснет после первого использования, и
// следующий контекст получает 401 на всех запросах. Коварство в том, что интерфейс при этом
// рендерится — role-cookie отдельная и живая, — поэтому выглядит как «пустые данные», а не
// как разлогин. В живом контексте ротация идёт естественно, как в настоящем браузере.
//
// Почему обе роли живут в ОДНОМ наборе фикстур, а не в двух отдельных `test`. При смене набора
// worker-фикстур Playwright поднимает новый воркер, а тот заново логинится. С чередованием ролей
// по файлам входов набегало шесть, тогда как POST /auth/login ограничен пятью на 15 минут с IP
// (§7.4) — и прогон падал на ровном месте, причём падал не тот тест, который потратил лимит.
// Отключать throttler запрещено (AGENTS.md), поэтому экономим входы: один воркер, два контекста,
// ровно два входа за прогон. Контекст роли создаётся лениво — только когда его запросил тест.

interface RoleFixtures {
  /** Вкладка студента: своя на каждый тест, контекст общий. */
  studentPage: Page
  /** Вкладка декана — сотрудник для сценариев обработки (заявки, расписание, посты). */
  deanPage: Page
}

interface RoleWorkerFixtures {
  studentContext: BrowserContext
  deanContext: BrowserContext
}

async function signedInContext(browser: Browser, role: Role): Promise<BrowserContext> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const rotationSettled = trackTokenRotation(page)
  await signIn(page, role)
  await rotationSettled()
  await page.close()
  return context
}

// Каждому тесту — своя вкладка в общем авторизованном контексте роли.
async function freshPage(
  context: BrowserContext,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const page = await context.newPage()
  const rotationSettled = trackTokenRotation(page)

  // Уход со страницы обрывает незавершённые запросы ровно так же, как её закрытие, поэтому
  // ротацию дожидаемся и перед навигацией: иначе новая cookie не доедет до контекста, следующая
  // загрузка придёт с погашенным токеном, и реюз-детектор убьёт сессию (docs/PROJECT.md §7.2).
  // Обёртка снимает эту заботу с тестов — сценарии просто вызывают page.goto().
  const navigate = page.goto.bind(page)
  page.goto = async (url, options) => {
    await rotationSettled()
    return navigate(url, options)
  }

  await use(page)
  await rotationSettled()
  await page.close()
}

export const test = base.extend<RoleFixtures, RoleWorkerFixtures>({
  studentContext: [
    async ({ browser }, use) => {
      const context = await signedInContext(browser, 'student')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  deanContext: [
    async ({ browser }, use) => {
      const context = await signedInContext(browser, 'dean')
      await use(context)
      await context.close()
    },
    { scope: 'worker' },
  ],
  studentPage: async ({ studentContext }, use) => {
    await freshPage(studentContext, use)
  },
  deanPage: async ({ deanContext }, use) => {
    await freshPage(deanContext, use)
  },
})

export { expect } from '@playwright/test'
