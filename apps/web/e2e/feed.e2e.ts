import { expect, studentTest as test } from './support/fixtures'

// Лента студента (план 13.4). Студент ленту только читает: композер поста живёт в зоне
// сотрудников (/dean/posts), поэтому публикация проверяется отдельно — posts.e2e.ts.

test('лента открывается и показывает посты', async ({ page }) => {
  await page.goto('/')
  // Посты из seed: карточка рендерится как <article>.
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 30_000 })
})
