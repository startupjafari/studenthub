import { expect, test } from './support/fixtures'

// Публикация поста (план 13.4). Композер доступен сотрудникам, у студента его нет
// (см. feed.e2e.ts) — поэтому сценарий идёт из-под сессии декана.
//
// Сессия декана работает благодаря TWO_FACTOR_ENFORCE=false на стенде (playwright.config.ts):
// seed создаёт сотрудников без второго фактора, а форс 2FA иначе отвечает 403 на каждом экране.
test('пост публикуется и появляется в ленте', async ({ deanPage: page }) => {
  await page.goto('/dean/posts')

  const composer = page.getByPlaceholder('Что нового?')
  await expect(composer).toBeVisible({ timeout: 30_000 })

  // Аудиторию выбираем явно: у декана их несколько, и полагаться на значение по умолчанию тест
  // не должен — иначе он проверяет ещё и то, какой пункт окажется первым. Контрол — Radix Select,
  // то есть кнопка со списком, а не нативный <select> (тот же скрыт под ним для форм).
  await page.getByRole('main').getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Факультет' }).click()

  const text = `e2e пост ${Date.now()}`
  await composer.fill(text)
  await page.getByRole('button', { name: 'Опубликовать' }).click()

  // Пост ищем в ленте под композером: тот же текст остаётся в поле ввода, пока форма не очистится.
  await expect(page.getByRole('article').filter({ hasText: text })).toBeVisible({ timeout: 20_000 })
})
