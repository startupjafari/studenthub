import { expect, test } from './support/fixtures'
import { clickUntil } from './support/interaction'

// Публикация поста (план 13.4). Композер доступен сотрудникам, у студента его нет
// (см. feed.e2e.ts) — поэтому сценарий идёт из-под сессии декана.
//
// Сессия декана работает благодаря TWO_FACTOR_ENFORCE=false на стенде (playwright.config.ts):
// seed создаёт сотрудников без второго фактора, а форс 2FA иначе отвечает 403 на каждом экране.
test('пост публикуется и появляется в ленте', async ({ deanPage: page }) => {
  await page.goto('/dean/posts')

  // Форма публикации живёт в модальном окне за кнопкой в шапке, а не раскрытой над лентой:
  // ленту читают несравнимо чаще, чем пишут (views/feed). Кнопку берём внутри main —
  // кнопка отправки внутри самого окна называется так же, а окно рисуется в портале.
  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('main').getByRole('button', { name: 'Опубликовать' }), dialog)

  // Аудиторию выбираем явно: у декана их несколько, и полагаться на значение по умолчанию тест
  // не должен — иначе он проверяет ещё и то, какой пункт окажется первым. Контрол — Radix Select,
  // то есть кнопка со списком, а не нативный <select> (тот же скрыт под ним для форм).
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Факультет' }).click()

  // Тот же RichTextField, что и в чатах: placeholder рисуется через ::before и
  // `getByPlaceholder` его не находит. У поля есть собственный id — целимся в него.
  const text = `e2e пост ${Date.now()}`
  await dialog.locator('#post-content').fill(text)
  await dialog.getByRole('button', { name: 'Опубликовать' }).click()

  // Окно закрывается само, а пост появляется в ленте под ним — карточка рендерится как <article>.
  await expect(page.getByRole('article').filter({ hasText: text }).first()).toBeVisible({
    timeout: 20_000,
  })
})
