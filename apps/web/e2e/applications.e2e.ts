import { expect, test } from './support/fixtures'

// Создание и обработка заявки (план 13.4) — сквозной путь через две роли в одном тесте:
// студент подаёт заявку, декан тут же принимает её в работу. Обе вкладки живут в своих
// авторизованных контекстах (support/fixtures.ts), поэтому переключение ролей ничего не стоит.
//
// Услуга «Транскрипт» выбрана намеренно: у неё нет полей формы и ровно одно требование —
// удостоверение личности. Поэтому путь короткий, но проходит все шаги мастера.

// Файл для загрузки: минимальный валидный PNG (1×1), чтобы не тащить фикстуру в репозиторий.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const SERVICE = 'Транскрипт'

test('заявка проходит путь от подачи студентом до принятия деканом', async ({
  studentPage: page,
  deanPage,
}) => {
  // ── Шаг 1: документ в хранилище. Без него мастер не пустит дальше шага «Документы»:
  // требование обязательное, а seed хранилище не наполняет.
  await page.goto('/documents')
  // Раздел открывается на «Обзоре» — загрузка живёт во вкладке «Мои документы». Клик повторяем до
  // результата: первый может уйти раньше гидратации, и тогда обработчика на кнопке ещё нет
  // (тот же приём, что в support/sign-in.ts).
  const uploadBtn = page.getByRole('button', { name: 'Загрузить документ' }).first()
  await expect(async () => {
    await page.getByRole('button', { name: 'Мои документы' }).click()
    await expect(uploadBtn).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 40_000 })
  await uploadBtn.click()

  const uploadModal = page.getByRole('dialog')
  await uploadModal.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Личные' }).click()
  await uploadModal.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: 'Удостоверение личности' }).click()
  await uploadModal.getByRole('button', { name: 'Далее' }).click()

  // Шаг «Файлы»: input скрыт за кнопкой, поэтому кладём файл прямо в него.
  await uploadModal
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'id-card.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await uploadModal.getByRole('button', { name: 'Далее' }).click()

  const docTitle = `e2e удостоверение ${Date.now()}`
  await uploadModal.getByRole('textbox').first().fill(docTitle)
  await uploadModal.getByRole('button', { name: 'Далее' }).click()
  await uploadModal.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByText(docTitle).first()).toBeVisible({ timeout: 20_000 })

  // ── Шаг 2: заявка. Каталог → услуга → данные → документы → проверка → отправка.
  await page.goto('/applications')
  const service = page.getByText(SERVICE).first()
  await expect(async () => {
    await page.getByRole('button', { name: 'Создать заявку' }).first().click()
    await expect(service).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 40_000 })
  await service.click()

  // Шаг услуги: пока черновика нет, кнопка называется «Создать заявку» — она и создаёт его
  // на сервере (дальше по мастеру та же кнопка станет «Далее»).
  await page.getByRole('button', { name: 'Создать заявку' }).first().click()
  // Шаг данных: у «Транскрипта» своих полей нет, но способ получения обязателен всегда —
  // без него «Далее» остаётся заблокированной.
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: 'Далее' }).first().click()

  // Шаг документов: прикладываем загруженное удостоверение из хранилища.
  await page.getByRole('button', { name: 'Выбрать из хранилища' }).first().click()
  await page.getByRole('button', { name: docTitle }).first().click()
  await page.getByRole('button', { name: 'Далее' }).first().click()

  await expect(page.getByText('Проверьте перед отправкой')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Отправить заявку' }).click()

  // Заявка ушла — она появляется в «Моих заявках» со статусом «Отправлена».
  await expect(page.getByText('Отправлена').first()).toBeVisible({ timeout: 20_000 })

  // ── Шаг 3: обработка. Декан видит заявку в очереди и принимает её в работу.
  await deanPage.goto('/dean/applications')
  await expect(deanPage.getByText('Очередь заявок')).toBeVisible({ timeout: 30_000 })

  // Ищем по названию услуги: seed заявок не создаёт, а прогон всегда идёт на пересозданной БД
  // (e2e/prepare-db.mjs), поэтому в очереди только что поданная заявка.
  const queued = deanPage.getByText(SERVICE).first()
  await expect(queued).toBeVisible({ timeout: 20_000 })
  await queued.click()

  const take = deanPage.getByRole('button', { name: 'Взять в работу' })
  await expect(take).toBeVisible({ timeout: 20_000 })
  await take.click()

  // Заявка ушла из «Отправлена» в работу — кнопка взятия исчезает, дальше идут шаги подготовки.
  await expect(take).toBeHidden({ timeout: 20_000 })
})
