import { expect, test, type Page, type Route } from '@playwright/test'
import { ACCOUNTS, PASSWORD } from './support/sign-in'

// Вход по ЭЦП (docs/PROJECT.md §8.3): кнопка → NCALayer → challenge → подпись → вход.
//
// Настоящего NCALayer на раннере нет, а настоящей подписи НУЦ стенд не проверит (NCANode в
// e2e не поднимается), поэтому подменены оба конца:
//
// — NCALayer — фейковым WebSocket на wss://127.0.0.1:13579 (page.addInitScript): он
//   здоровается, как настоящий, и отвечает на запрос модуля basics по сценарию теста;
// — `/auth/eds/config|challenge|login` — перехватом. Сам вход при этом настоящий: перехват
//   `/auth/eds/login` входит паролем декана через API контекста — cookie сессии (refresh и
//   роль для middleware) попадают в браузер, а странице уходит его accessToken. Так после
//   «входа по ЭЦП» открывается настоящий домашний экран, а не заглушка.

type NcaLayerMode = 'sign' | 'cancel' | 'refuse'

const FAKE_CMS = 'MIIfakeDetachedCms=='
const NONCE = 'c3R1ZGVudGh1Yi1lMmUtbm9uY2U='
const CHALLENGE_ID = '5b0f8a51-6a4e-4d4b-9f39-0c7d2d1e8a11'

/** Подменить NCALayer в странице. Остальные WebSocket (socket.io) идут как обычно. */
async function fakeNcaLayer(page: Page, mode: NcaLayerMode): Promise<void> {
  await page.addInitScript((scenario: NcaLayerMode) => {
    const w = window as unknown as { __ncaRequests: unknown[] }
    w.__ncaRequests = []

    // Разрешение на доступ к локальной сети в headless-браузере непредсказуемо — считаем,
    // что браузер такой проверки не знает: отказ соединения значит «NCALayer не запущен».
    const permissions = navigator.permissions
    if (permissions?.query) {
      const query = permissions.query.bind(permissions)
      permissions.query = (descriptor: PermissionDescriptor) =>
        ['loopback-network', 'local-network-access'].includes(descriptor.name)
          ? Promise.reject(new TypeError('unsupported permission'))
          : query(descriptor)
    }

    type Handler = ((event: unknown) => void) | null
    class FakeNcaLayer {
      readyState = 0
      onopen: Handler = null
      onmessage: Handler = null
      onerror: Handler = null
      onclose: Handler = null

      constructor(readonly url: string) {
        setTimeout(() => {
          if (scenario === 'refuse') {
            this.readyState = 3
            this.onerror?.({})
            this.onclose?.({})
            return
          }
          this.readyState = 1
          this.onopen?.({})
          this.onmessage?.({ data: JSON.stringify({ result: { version: '1.4' } }) })
        }, 20)
      }

      send(data: string): void {
        w.__ncaRequests.push(JSON.parse(data))
        // Человек выбрал ключ и ввёл пароль — или закрыл окно.
        const reply =
          scenario === 'cancel'
            ? { status: true, body: {} }
            : { status: true, body: { result: ['MIIfakeDetachedCms=='] } }
        setTimeout(() => this.onmessage?.({ data: JSON.stringify(reply) }), 50)
      }

      close(): void {
        this.readyState = 3
      }
    }

    const Original = window.WebSocket
    window.WebSocket = new Proxy(Original, {
      construct(target, args: [string | URL, (string | string[])?]) {
        if (String(args[0]).startsWith('wss://127.0.0.1:13579')) {
          return new FakeNcaLayer(String(args[0])) as unknown as WebSocket
        }
        return Reflect.construct(target, args)
      },
    })
  }, mode)
}

/** Сервер: вход по ЭЦП включён, challenge выдаётся. Счётчик — сколько challenge запросили. */
async function serveEdsApi(page: Page): Promise<{ challenges: () => number }> {
  let challenges = 0
  await page.route(/\/auth\/eds\/config$/, (route: Route) =>
    route.fulfill({ json: { success: true, data: { enabled: true } } }),
  )
  await page.route(/\/auth\/eds\/challenge$/, (route: Route) => {
    challenges += 1
    return route.fulfill({
      json: {
        success: true,
        data: {
          challengeId: CHALLENGE_ID,
          nonce: NONCE,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
      },
    })
  })
  return { challenges: () => challenges }
}

const edsButton = (page: Page) => page.getByRole('button', { name: 'Войти с ЭЦП' })

test.describe('Вход по ЭЦП', () => {
  test('NCALayer подписывает challenge — вход выполнен', async ({ page }) => {
    await fakeNcaLayer(page, 'sign')
    await serveEdsApi(page)

    let loginBody: unknown = null
    await page.route(/\/auth\/eds\/login$/, async (route: Route) => {
      loginBody = route.request().postDataJSON()
      // Настоящая сессия декана: cookie ложатся в контекст браузера, токен — странице.
      const loginUrl = route
        .request()
        .url()
        .replace(/\/auth\/eds\/login$/, '/auth/login')
      const res = await page.request.post(loginUrl, {
        data: { identifier: ACCOUNTS.dean, password: PASSWORD },
      })
      expect(res.ok()).toBe(true)
      await route.fulfill({ json: await res.json() })
    })

    await page.goto('/login')
    await edsButton(page).click()

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

    // На сервер ушла ровно та подпись, что вернул NCALayer, к выданному challenge.
    expect(loginBody).toEqual({ challengeId: CHALLENGE_ID, cms: FAKE_CMS })

    // NCALayer просили об открепленной CMS над байтами nonce ключом аутентификации.
    const requests = await page.evaluate(
      () => (window as unknown as { __ncaRequests: unknown[] }).__ncaRequests,
    )
    expect(requests).toEqual([
      expect.objectContaining({
        module: 'kz.gov.pki.knca.basics',
        method: 'sign',
        args: expect.objectContaining({
          format: 'cms',
          data: NONCE,
          signingParams: { decode: true, encapsulate: false, digested: false },
          signerParams: expect.objectContaining({ extKeyUsageOids: [] }),
          locale: 'ru',
        }),
      }),
    ])
  })

  test('NCALayer не запущен — подсказка со ссылкой, challenge не тратится', async ({ page }) => {
    await fakeNcaLayer(page, 'refuse')
    const api = await serveEdsApi(page)

    await page.goto('/login')
    await edsButton(page).click()

    await expect(page.getByText('NCALayer не отвечает')).toBeVisible()
    await expect(page.getByRole('link', { name: /Скачать NCALayer/ })).toHaveAttribute(
      'href',
      'https://ncl.pki.gov.kz/',
    )
    expect(api.challenges()).toBe(0)
    await expect(page).toHaveURL(/\/login/)
  })

  test('окно NCALayer закрыто без выбора ключа — тихо возвращаемся к форме', async ({ page }) => {
    await fakeNcaLayer(page, 'cancel')
    await serveEdsApi(page)
    let loginCalls = 0
    await page.route(/\/auth\/eds\/login$/, (route: Route) => {
      loginCalls += 1
      return route.abort()
    })

    await page.goto('/login')
    await edsButton(page).click()

    // NCALayer получил запрос и ответил отменой…
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __ncaRequests: unknown[] }).__ncaRequests.length,
        ),
      )
      .toBe(1)
    // …кнопка снова доступна, ошибок нет, вход не запрашивался.
    await expect(edsButton(page)).toBeEnabled()
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    expect(loginCalls).toBe(0)
    await expect(page).toHaveURL(/\/login/)
  })

  test('ЭЦП не привязана — понятный отказ с подсказкой войти паролем', async ({ page }) => {
    await fakeNcaLayer(page, 'sign')
    await serveEdsApi(page)
    await page.route(/\/auth\/eds\/login$/, (route: Route) =>
      route.fulfill({
        status: 401,
        json: {
          success: false,
          error: { code: 'EDS_NOT_LINKED', message: 'ЭЦП не привязана' },
        },
      }),
    )

    await page.goto('/login')
    await edsButton(page).click()

    // Текст — из словаря по коду ошибки, а не message сервера (FRONTEND_RULES §5.4).
    await expect(page.locator('[data-sonner-toast]').first()).toContainText('Войдите по паролю')
    await expect(page).toHaveURL(/\/login/)
  })
})
