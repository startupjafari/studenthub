import type { Page, Route } from '@playwright/test'
import { expect, test } from './support/fixtures'

// Плавная история чата (как в Telegram Web): лента держит ограниченное окно, догружает
// историю заранее и не прыгает под глазами. История — синтетическая, 1000 сообщений: ответ
// GET /chats/:id/messages подменяется перехватом, поэтому сценарий не зависит от сида и не
// упирается в лимит запросов API.

const TOTAL = 1000
const BASE_TIME = Date.parse('2026-01-01T09:00:00Z')

type Synthetic = ReturnType<typeof message>

function message(chatId: string, seq: number, senderId: string) {
  // Разная длина — разная высота строк: на одинаковых строках прыжки не видны.
  const text =
    seq % 7 === 0
      ? `Сообщение ${seq}\nвторая строка\nтретья строка с текстом подлиннее, чтобы перенос был`
      : seq % 3 === 0
        ? `Сообщение ${seq} — средней длины, чтобы строка заняла ширину пузыря целиком и чуть больше`
        : `Сообщение ${seq}`
  return {
    id: `e2e-${chatId}-${seq}`,
    chatId,
    seq,
    senderId,
    content: text,
    replyToId: null,
    replyQuote: null,
    silent: false,
    forwardedFromId: null,
    editedAt: null,
    pinnedAt: null,
    // Минута на сообщение: шесть дней истории — с пометками дней по пути.
    createdAt: new Date(BASE_TIME + seq * 9 * 60_000).toISOString(),
    sender: { id: senderId, firstName: 'Тест', lastName: 'Историков', avatarUrl: null },
    linkPreview: null,
    media: [],
    replyTo: null,
    forwardedFrom: null,
    sharedPost: null,
    reactions: [],
    poll: null,
    systemType: null,
    systemMeta: null,
  }
}

/** Подменить историю чата: курсоры — id сообщений, как у настоящего API. */
async function serveHistory(page: Page): Promise<{ pages: () => number }> {
  let pages = 0
  const cache = new Map<string, Synthetic[]>()
  const all = (chatId: string): Synthetic[] => {
    let list = cache.get(chatId)
    if (!list) {
      list = Array.from({ length: TOTAL }, (_, i) => message(chatId, i + 1, 'e2e-sender'))
      cache.set(chatId, list)
    }
    return list
  }
  await page.route(/\/chats\/[^/]+\/messages(\?|$)/, async (route: Route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET') return route.fallback()
    pages += 1
    const chatId = url.pathname.split('/').at(-2) ?? ''
    const list = all(chatId)
    const limit = Number(url.searchParams.get('limit') ?? 30)
    // Как настоящий API: больше 50 за раз — ошибка валидации (CursorPaginationSchema).
    if (limit > 50) {
      return route.fulfill({ status: 422, json: { success: false, error: { code: 'VALIDATION' } } })
    }
    const cursor = url.searchParams.get('cursor')
    const newer = url.searchParams.get('direction') === 'newer'
    const at = cursor ? list.findIndex((m) => m.id === cursor) : list.length
    let slice: Synthetic[]
    let hasNext: boolean
    let hasPrev: boolean
    if (newer) {
      slice = list.slice(at + 1, at + 1 + limit)
      hasNext = at >= 0
      hasPrev = at + 1 + limit < list.length
    } else {
      const from = Math.max(0, at - limit)
      slice = list.slice(from, at)
      hasNext = from > 0
      hasPrev = at < list.length
    }
    // API отдаёт новые первыми.
    const items = [...slice].reverse()
    await route.fulfill({
      json: {
        success: true,
        data: items,
        meta: {
          cursor: newer ? items[0]?.id : items[items.length - 1]?.id,
          hasNext,
          prevCursor: newer ? items[items.length - 1]?.id : items[0]?.id,
          hasPrev,
        },
      },
    })
  })
  return { pages: () => pages }
}

/**
 * Следит за лентой каждый кадр: верхнее видимое сообщение и его экранная позиция. Контент
 * «прыгнул» — если сообщение сместилось не на столько, на сколько прокрутили ленту.
 */
async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __probe: { jumps: number; maxJump: number; maxRows: number; seen: Set<string> }
      __probeStop: boolean
    }
    const sc = document.querySelector('[id^="msg-"]')?.closest('.overflow-y-auto') as HTMLElement
    w.__probe = { jumps: 0, maxJump: 0, maxRows: 0, seen: new Set() }
    let prev: { id: string; top: number; st: number } | null = null
    const tick = (): void => {
      const p = w.__probe
      const rows = sc.querySelectorAll('[id^="msg-"]')
      p.maxRows = Math.max(p.maxRows, rows.length)
      const r = sc.getBoundingClientRect()
      let anchor: { id: string; top: number } | null = null
      for (const el of rows) {
        p.seen.add(el.id)
        const b = el.getBoundingClientRect()
        if (!anchor && b.bottom > r.top + 20 && b.top < r.bottom) anchor = { id: el.id, top: b.top }
      }
      if (prev) {
        const el = document.getElementById(prev.id)
        if (el) {
          const err = Math.abs(el.getBoundingClientRect().top - prev.top + (sc.scrollTop - prev.st))
          if (err > 3) {
            p.jumps += 1
            p.maxJump = Math.max(p.maxJump, err)
          }
        }
      }
      prev = anchor ? { ...anchor, st: sc.scrollTop } : null
      if (!w.__probeStop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function readProbe(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __probe: { jumps: number; maxJump: number; maxRows: number; seen: Set<string> }
      __probeStop: boolean
    }
    w.__probeStop = true
    const p = w.__probe
    return { jumps: p.jumps, maxJump: p.maxJump, maxRows: p.maxRows, seen: p.seen.size }
  })
}

test('история листается вверх без прыжков и упоров, окно ленты ограничено', async ({
  studentPage: page,
}) => {
  const history = await serveHistory(page)
  await page.goto('/chats')
  const chat = page.getByRole('button', { name: /Машинное обучение/ }).first()
  await expect(chat).toBeVisible({ timeout: 30_000 })
  await chat.click()

  // Открылся внизу: последнее сообщение синтетической истории на экране.
  const last = page.locator(`[id^="msg-e2e-"][id$="-${TOTAL}"]`)
  await expect(last).toBeVisible({ timeout: 15_000 })

  await startProbe(page)
  const list = page.locator('[id^="msg-"]').first()
  const box = await list.evaluate((el) => {
    const r = (el.closest('.overflow-y-auto') as HTMLElement).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.mouse.move(box.x, box.y)
  // Восемь секунд быстрой прокрутки колесом вверх.
  const until = Date.now() + 8_000
  while (Date.now() < until) {
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(500)
  const probe = await readProbe(page)

  // Под глазами ничего не прыгало: ни догрузка сверху, ни обрезка окна снизу.
  expect(probe.jumps, `прыжки контента (макс. ${probe.maxJump}px)`).toBe(0)
  // История приходила заранее и страницами: пролистано далеко вглубь.
  expect(probe.seen).toBeGreaterThan(400)
  expect(history.pages()).toBeGreaterThan(5)
  // В DOM — окно, а не вся пролистанная история.
  expect(probe.maxRows).toBeLessThanOrEqual(200 + 50)

  // Обратно вниз — кнопкой «вниз»: лента возвращается к последнему сообщению.
  await page.getByRole('main').getByRole('button', { name: /^Вниз/ }).click()
  await expect(last).toBeVisible({ timeout: 15_000 })
})
