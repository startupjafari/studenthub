import { expect, studentTest as test } from './support/fixtures'

// Отправка сообщения (план 13.4). Сессия студента — из фикстуры.
// Заодно это проверка realtime-контура: пузырь появляется не от локального стейта, а после
// эха message:new с сервера (docs/PROJECT.md §9.4).

test('сообщение отправляется и появляется в переписке', async ({ page }) => {
  await page.goto('/chats')

  // Список виртуализирован (virtua): в DOM только видимые строки, поэтому целимся в чат
  // предмета — он создаётся лениво на первом GET /chats по парам активного расписания группы
  // (seed кладёт студента в демо-группу, у неё есть пара по этому предмету) и попадает в начало
  // списка как самый свежий. Фильтровать по бейджу типа нельзя — «Предметы» сверху это вкладка
  // папки, а не чат.
  const chat = page.getByRole('button', { name: /Машинное обучение/ }).first()
  await expect(chat).toBeVisible({ timeout: 30_000 })
  await chat.click()

  // Именно поле ввода сообщения: в левой колонке есть ещё поиск по чатам.
  const composer = page.getByPlaceholder('Сообщение')
  await expect(composer).toBeVisible({ timeout: 15_000 })

  // Уникальный текст: история чата между прогонами сбрасывается не всегда.
  const text = `e2e проверка ${Date.now()}`
  await composer.fill(text)
  await composer.press('Enter')

  // Ищем пузырь именно в переписке: тот же текст появляется и в левой колонке — превью
  // последнего сообщения чата («Вы: …»), и незаякоренный getByText нашёл бы два совпадения.
  await expect(page.getByRole('main').getByText(text)).toBeVisible({ timeout: 20_000 })
})
