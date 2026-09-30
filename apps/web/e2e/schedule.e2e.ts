import { expect, test } from './support/fixtures'

// Изменение расписания (план 13.4): декан добавляет пару в активную версию расписания группы.
// Сессия декана доступна благодаря TWO_FACTOR_ENFORCE=false на стенде (см. posts.e2e.ts).

// День пары выбираем явно и по номеру попытки. Модалка открывается на сегодняшнем дне, а
// он бывает и выходным — выходные колонки в сетке по умолчанию скрыты, и добавленной пары
// не было бы видно. Номер попытки важен потому, что БД между ретраями не пересоздаётся:
// повторная попытка заняла бы тот же слот и получила бы от сервера конфликт.
const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'] as const

test('декан добавляет пару в расписание группы', async ({ deanPage: page }, testInfo) => {
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

  await dialog.getByRole('combobox', { name: 'День' }).click()
  const day = DAYS[testInfo.retry % DAYS.length] ?? DAYS[0]
  await page.getByRole('option', { name: day }).click()

  // Время сдвигаем на вечер: seed ставит пары в первой половине дня, а пересечение сервер
  // вернул бы конфликтом. Сетка охватывает 07:00–20:00 — вечерняя пара в неё попадает.
  await dialog.locator('#p-start').fill('18:00')
  await dialog.locator('#p-end').fill('19:30')

  await dialog.getByRole('button', { name: 'Добавить пару' }).click()

  // Пара появляется в сетке календаря — именно это и означает изменённое расписание.
  // Ищем по роли, а не по тексту: на узкий экран расписание рисуется вторым, списочным
  // видом, и на десктопе он существует в разметке, но скрыт — `getByText` цеплялся именно
  // за него. У блока пары в сетке есть доступное имя «предмет, день время».
  await expect(page.getByRole('button', { name: subject })).toBeVisible({ timeout: 20_000 })
})
