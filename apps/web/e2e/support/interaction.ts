import { expect, type Locator } from '@playwright/test'

/**
 * Клик по элементу, который может ещё не слушать события.
 *
 * Страницы рендерятся на сервере: до гидратации у кнопки нет обработчика, и первый клик
 * уходит в пустоту — ровно та же беда, что у формы логина (support/sign-in.ts). Поэтому
 * кликаем, пока не появится то, ради чего кликали.
 *
 * Повторный клик делаем ТОЛЬКО если результата ещё нет: если клик уже открыл модальное
 * окно, следующий упёрся бы в его фон и ждал бы кликабельности до конца теста.
 */
export async function clickUntil(
  target: Locator,
  expected: Locator,
  timeout = 40_000,
): Promise<void> {
  await expect(async () => {
    if (!(await expected.isVisible())) await target.click({ timeout: 5_000 })
    await expect(expected).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout })
}
