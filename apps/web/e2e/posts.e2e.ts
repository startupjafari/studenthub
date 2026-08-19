import { expect, deanTest as test } from './support/fixtures'

// Публикация поста (план 13.4). Композер доступен сотрудникам, у студента его нет
// (см. feed.e2e.ts) — поэтому сценарий идёт из-под сессии декана.
//
// ОТКЛЮЧЁН до решения по тестовым данным. Ролям уровня декана и выше API отвечает
// 403 TWO_FACTOR_SETUP_REQUIRED, пока у аккаунта не включена двухфакторная аутентификация,
// а prisma/seed.mjs создаёт сотрудников без неё. В интерфейсе это выглядит как «Ошибка
// сервера» на каждом экране сотрудника. Варианты: включать TOTP в seed для тестовых
// аккаунтов, либо проходить настройку 2FA прямо в тесте (нужен генератор кодов).
// Решение за командой — оба меняют либо seed, либо зависимости.
test.skip('пост публикуется и появляется в ленте', async ({ page }) => {
  await page.goto('/dean/posts')

  const composer = page.getByPlaceholder('Что нового?')
  await expect(composer).toBeVisible({ timeout: 30_000 })

  const text = `e2e пост ${Date.now()}`
  await composer.fill(text)
  await page.getByRole('button', { name: 'Опубликовать' }).click()

  await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 })
})
