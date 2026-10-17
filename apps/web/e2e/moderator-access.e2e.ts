import { expect, test } from './support/fixtures'

// Зона модераторов закрыта для остальных ролей (FRONTEND_RULES §12, обязательный негатив).
//
// Модерация — жалобы, переписка по жалобе, блокировки — самая чувствительная зона после
// админских. Её проверяет тот же RoleGuard в layout'е, что и зону декана (access.e2e.ts):
// чужая роль получает 403-экран на том же URL, а не редирект. Аккаунтов модераторов в
// наборе фикстур нет намеренно — каждый вход тратит лимит POST /auth/login (fixtures.ts),
// поэтому зону проверяют те роли, что уже вошли: студент и декан.

test('в зоне модератора вуза студент видит 403 вместо очереди жалоб', async ({
  studentPage: page,
}) => {
  await page.goto('/moderator/university/complaints')

  await expect(page.getByText('403')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Недостаточно прав')).toBeVisible()
  // Сессия жива — дело в роли, а не в разлогине.
  await expect(page).not.toHaveURL(/\/login/)
})

test('в зоне модератора платформы студент видит 403', async ({ studentPage: page }) => {
  await page.goto('/moderator/platform/complaints')

  await expect(page.getByText('403')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Недостаточно прав')).toBeVisible()
})

// Декан — сотрудник вуза, но не модератор: свои полномочия по факультету не открывают ему
// разбор жалоб и чужую переписку.
test('декан в зоне модератора вуза тоже получает 403', async ({ deanPage: page }) => {
  await page.goto('/moderator/university/chats')

  await expect(page.getByText('403')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Недостаточно прав')).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
})
