import { expect, test } from './support/fixtures'

// Доступ по роли (FRONTEND_RULES §12, обязательный негатив).
//
// Чужая зона не редиректит, а рендерит 403-экран на том же URL — так предписывает §3
// («Студент, открывший /dean/..., получает 403-экран, а не пустую страницу»). Проверяет это
// RoleGuard в layout'е каждой ролевой зоны, поэтому и утверждение здесь про содержимое,
// а не про адрес: редирект как раз означал бы, что дизайн разъехался с документацией.

test('в зоне декана студент видит 403 вместо интерфейса', async ({ studentPage: page }) => {
  await page.goto('/dean/applications')

  await expect(page.getByText('403')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Недостаточно прав')).toBeVisible()
  // Не выкинуло на логин — сессия жива, дело именно в роли.
  await expect(page).not.toHaveURL(/\/login/)
})

test('студенту доступен его собственный раздел', async ({ studentPage: page }) => {
  await page.goto('/applications')
  await expect(page).toHaveURL(/\/applications/)
  await expect(page.getByText('Недостаточно прав')).toBeHidden()
})
