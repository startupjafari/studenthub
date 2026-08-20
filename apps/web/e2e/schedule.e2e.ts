import { expect, test } from './support/fixtures'

// Изменение расписания (план 13.4): декан добавляет пару в активную версию расписания группы.
// Сессия декана доступна благодаря TWO_FACTOR_ENFORCE=false на стенде (см. posts.e2e.ts).

test('декан добавляет пару в расписание группы', async ({ deanPage: page }) => {
  await page.goto('/dean/schedule')

  // Группу берём первой из списка: имена генерирует seed, и завязка на конкретное («ИТ-21-1»)
  // ломала бы тест при любой правке генератора. Контролы — Radix Select, то есть кнопка со
  // списком, а не нативный <select>.
  const groupSelect = page.getByRole('main').getByRole('combobox').first()
  await expect(groupSelect).toBeVisible({ timeout: 30_000 })
  await groupSelect.click()
  await page.getByRole('option').first().click()

  // Кнопка живёт в правой колонке и показывается, пока не выбрана ни одна пара.
  await page.getByRole('button', { name: 'Добавить пару' }).click()

  const dialog = page.getByRole('dialog')
  const subject = `e2e пара ${Date.now()}`
  await dialog.getByLabel('Предмет').fill(subject)

  // Время сдвигаем на вечер: модалка предзаполняет понедельник 08:00–09:30, а seed ставит первую
  // пару в 08:30 — пересечение, и сервер вернул бы конфликт. Последний слот seed — 15:40–17:10.
  await dialog.locator('#start').fill('18:00')
  await dialog.locator('#end').fill('19:30')

  await dialog.getByRole('button', { name: 'Добавить пару' }).click()

  // Пара появляется в сетке календаря — именно это и означает изменённое расписание.
  await expect(page.getByText(subject).first()).toBeVisible({ timeout: 20_000 })
})
