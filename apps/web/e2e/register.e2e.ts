import { expect, test } from '@playwright/test'

// Регистрация по инвайту (план 13.4) + негативы по FRONTEND_RULES §12.
// Гоняется из-под гостя: базовый `test` из @playwright/test даёт чистый контекст без сессии,
// в отличие от фикстур в support/fixtures.ts.
//
// ВАЖНО: позитивный сценарий ГАСИТ инвайт — он одноразовый. Поэтому прогон рассчитан на
// свежую БД: скрипт `e2e` пересоздаёт её перед каждым запуском. Повторный `playwright test`
// без подготовки базы завалит этот тест — так и задумано, иначе он врал бы о состоянии системы.

// Инвайт для UNIVERSITY_ADMIN из prisma/seed.mjs.
const SEED_INVITE = 'seed-invite-university-admin-token'

test.describe('Регистрация по инвайту', () => {
  test('несуществующий токен — форма не показывается', async ({ page }) => {
    await page.goto('/register?token=нет-такого-токена')
    await expect(page.getByText('Приглашение недействительно')).toBeVisible()
    await expect(page.getByLabel('Имя пользователя')).toBeHidden()
  })

  test('без токена — форма не показывается', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByText('Приглашение недействительно')).toBeVisible()
  })

  test('валидный инвайт создаёт аккаунт и пускает в приложение', async ({ page }) => {
    await page.goto(`/register?token=${SEED_INVITE}`)
    await expect(page.getByText('Создание аккаунта')).toBeVisible({ timeout: 15_000 })

    // Логин должен быть уникальным: username в системе один на всех.
    const username = `e2e_admin_${Date.now()}`
    await page.locator('#firstName').fill('Тест')
    await page.locator('#lastName').fill('Проверкин')
    await page.locator('#username').fill(username)
    await page.locator('#password').fill('E2ePassw0rd!')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()

    await page.waitForURL((url) => !url.pathname.startsWith('/register'), { timeout: 30_000 })
    await expect(page).not.toHaveURL(/\/register/)
  })

  test('использованный инвайт больше не принимается', async ({ page }) => {
    // Идёт следом за позитивным сценарием: тот погасил инвайт (workers: 1, порядок сохраняется).
    await page.goto(`/register?token=${SEED_INVITE}`)
    await expect(page.getByText('Приглашение недействительно')).toBeVisible({ timeout: 15_000 })
  })
})
