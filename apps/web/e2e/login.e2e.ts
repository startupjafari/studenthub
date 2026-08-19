import { expect, test } from '@playwright/test'
import { ACCOUNTS, PASSWORD, signIn } from './support/sign-in'

// Флоу входа (план 13.4) + обязательный негатив (FRONTEND_RULES §12).

test.describe('Вход', () => {
  test('верные данные пускают в приложение', async ({ page }) => {
    await signIn(page, 'student')
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('неверный пароль оставляет на форме и показывает ошибку', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#identifier').fill(ACCOUNTS.student)
    await page.locator('#password').fill(`не-${PASSWORD}`)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()

    // Остаёмся на форме…
    await expect(page).toHaveURL(/\/login/)
    // …и пользователю сказано, что пошло не так (текст — из i18n по коду ошибки, §5.4).
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  })
})
