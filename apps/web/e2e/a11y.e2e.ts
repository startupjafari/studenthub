import { expect, test } from './support/fixtures'

// Доступность и адаптивность (план 13.7): 375 / 768 / 1280, клавиатурная навигация.
//
// Проверяем машинно-проверяемое: горизонтальную прокрутку (главный симптом сломанной вёрстки на
// узком экране), достижимость навигации с клавиатуры и видимый фокус. Контраст палитры проверяется
// отдельно и дешевле — в unit-тесте shared/ui/theme-contrast.test.ts.

const VIEWPORTS = [
  { name: 'мобильный', width: 375, height: 812 },
  { name: 'планшет', width: 768, height: 1024 },
  { name: 'десктоп', width: 1280, height: 800 },
]

// Ключевые экраны студента: лента, чаты, расписание, заявки, документы.
const ROUTES = ['/', '/chats', '/schedule', '/applications', '/documents']

// Экраны сотрудника: плотные таблицы и очереди — именно они первыми ломаются на узком экране.
const STAFF_ROUTES = ['/dean/applications', '/dean/schedule', '/dean/posts', '/dean/students']

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} (${viewport.width}px): экраны без горизонтальной прокрутки`, async ({
    studentPage: page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    const overflowing: string[] = []
    for (const route of ROUTES) {
      await page.goto(route)
      // Ждём каркас: до гидратации ширина ещё не показательна.
      await page.getByRole('main').waitFor({ timeout: 30_000 })
      const overflow = await page.evaluate(() => {
        // 1 px допускаем на скругления и субпиксельные границы.
        const doc = document.documentElement
        return doc.scrollWidth - doc.clientWidth
      })
      if (overflow > 1) overflowing.push(`${route}: +${overflow}px`)
    }
    expect(overflowing, 'экраны, вылезающие за ширину окна').toEqual([])
  })
}

test('навигация доступна с клавиатуры и фокус виден', async ({ studentPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByRole('main').waitFor({ timeout: 30_000 })

  // Идём табом от начала страницы, пока фокус не окажется на ссылке навигации.
  await page.keyboard.press('Tab')
  let reached = false
  for (let i = 0; i < 40 && !reached; i += 1) {
    reached = await page.evaluate(() => {
      const el = document.activeElement
      return el?.tagName === 'A' && Boolean(el.closest('nav'))
    })
    if (!reached) await page.keyboard.press('Tab')
  }
  expect(reached, 'до навигации не добраться табом').toBe(true)

  // Фокус должен быть видим — иначе клавиатурой невозможно понять, где ты.
  const focusVisible = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return false
    const style = getComputedStyle(el)
    const ring = style.getPropertyValue('box-shadow')
    const outline = style.getPropertyValue('outline-style')
    return (ring !== 'none' && ring !== '') || (outline !== 'none' && outline !== '')
  })
  expect(focusVisible, 'у сфокусированного элемента нет видимого фокуса').toBe(true)

  // Enter на ссылке навигации уводит на её маршрут.
  const href = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? '')
  await page.keyboard.press('Enter')
  await page.waitForURL((url) => url.pathname === href, { timeout: 15_000 })
})

test('модальное окно закрывается клавишей Escape', async ({ studentPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/documents')

  // Мастер загрузки — типичная модалка приложения.
  const uploadBtn = page.getByRole('button', { name: 'Загрузить документ' }).first()
  await expect(async () => {
    await page.getByRole('button', { name: 'Мои документы' }).click()
    await expect(uploadBtn).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 40_000 })
  await uploadBtn.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 10_000 })
})

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} (${viewport.width}px): экраны сотрудника без горизонтальной прокрутки`, async ({
    deanPage: page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    const overflowing: string[] = []
    for (const route of STAFF_ROUTES) {
      await page.goto(route)
      await page.getByRole('main').waitFor({ timeout: 30_000 })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      if (overflow > 1) overflowing.push(`${route}: +${overflow}px`)
    }
    expect(overflowing, 'экраны сотрудника, вылезающие за ширину окна').toEqual([])
  })
}

test('у всех видимых кнопок есть доступное имя', async ({ studentPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })

  const nameless: string[] = []
  for (const route of ROUTES) {
    await page.goto(route)
    await page.getByRole('main').waitFor({ timeout: 30_000 })
    const found = await page.evaluate(() => {
      const problems: string[] = []
      for (const el of document.querySelectorAll('button, [role="button"], a')) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        const name =
          (el.getAttribute('aria-label') ?? '') +
          (el.getAttribute('title') ?? '') +
          (el.textContent ?? '')
        if (name.trim() === '') problems.push(el.outerHTML.slice(0, 90))
      }
      return problems
    })
    for (const problem of found) nameless.push(`${route}: ${problem}`)
  }
  // Скринридер объявит такую кнопку как «кнопка» — что она делает, понять нельзя.
  expect(nameless, 'элементы без доступного имени').toEqual([])
})
