import { expect, type Page } from '@playwright/test'

// Вход для e2e. Логинимся в каждом тесте, а не переиспользуем storageState, и на то две причины.
//
// 1. Refresh-токен одноразовый и ротируется при каждом обмене (docs/PROJECT.md §7.2). Сохранённая
//    в файл cookie гаснет, как только ею воспользуется первый же контекст, — следующий тест
//    приходит с погашенной сессией и его выкидывает на /login.
// 2. Форма логина рендерится на сервере: до гидратации у неё нет обработчика submit, и клик
//    уходит нативным GET-сабмитом (в адресной строке всплывает ?identifier=...&password=...).
//    Поэтому перед вводом ждём, пока React перехватит управление.

// Аккаунты создаёт prisma/seed.mjs — тестовые данные, не секреты.
export const PASSWORD = 'Admin1234!'
export const ACCOUNTS = {
  student: 'student@studenthub.app',
  dean: 'dean@studenthub.app',
  teacher: 'teacher@studenthub.app',
} as const

export type Role = keyof typeof ACCOUNTS

/**
 * Признак завершённой гидратации: кнопка-глазок переключает тип поля пароля, а это чистая
 * клиентская реакция. Сработала — значит React уже на месте и submit не уйдёт нативно.
 */
async function waitForHydration(page: Page): Promise<void> {
  const password = page.locator('#password')
  const toggle = page.getByRole('button', { name: 'Показать пароль' })
  await expect(toggle).toBeVisible()
  await expect(async () => {
    await toggle.click()
    await expect(password).toHaveAttribute('type', 'text', { timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  // Возвращаем поле в исходное состояние, чтобы тест не зависел от побочного эффекта проверки.
  await page.getByRole('button', { name: 'Скрыть пароль' }).click()
  await expect(password).toHaveAttribute('type', 'password')
}

export async function signIn(page: Page, role: Role = 'student'): Promise<void> {
  await page.goto('/login')
  await waitForHydration(page)

  await page.locator('#identifier').fill(ACCOUNTS[role])
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
}
