import type { BrowserContext, Page } from '@playwright/test'
import { expect, freshPage, signedInContext, test } from './support/fixtures'
import type { Role } from './support/sign-in'

// Вход и ключевые экраны остальных ролей (план 21.E3). Студент и декан проходят свои
// сценарии в отдельных файлах; здесь — админ вуза, преподаватель, староста, охрана,
// библиотекарь и работодатель.
//
// ВХОДЫ. По одному на роль за весь файл: контекст роли поднимается в beforeAll тем же
// signedInContext, что и у фикстур студента и декана (живой контекст, а не storageState —
// почему, см. fixtures.ts), и все экраны роли открываются вкладками в нём. На стенде
// лимит входов снят штатным THROTTLE_DISABLED (playwright.config.ts), но и без него шесть
// ролей укладывались бы в бюджет только так — по входу на роль, не на экран.
//
// ЧТО ПРОВЕРЯЕТСЯ. Вход приводит на домашнюю страницу роли (ROLE_HOME), каждый ключевой
// экран открывается на своём адресе — без 403-экрана, без экрана сбоя и без выброса на
// /login — и показывает данные фикстуры (prisma/e2e-fixture.mjs), то есть API ответил.
// Широкий обход всех экранов — дело a11y-axe.e2e.ts и UI-аудита; здесь — по смысловому
// признаку на ключевых экранах роли.

interface Screen {
  path: string
  /** Где экран живёт на самом деле, если адрес — старый и ведёт редиректом. */
  landsAt?: string
  /** Текст из данных фикстуры: виден — значит экран не только отрисовался, но и получил данные. */
  shows?: string | RegExp
}

interface RoleCase {
  role: Role
  home: string
  screens: Screen[]
  /** Чужой экран: ограниченную роль middleware возвращает домой, остальным он рендерит 403. */
  foreign: { path: string; expect: 'home' | '403' }
}

// Значения фикстуры (prisma/e2e-fixture.mjs).
const FACULTY = 'Факультет информационных технологий'
const GROUP = 'ИТ-23-1'
const SUBJECT = 'Машинное обучение'
const UNIVERSITY = /Алатау/

const CASES: RoleCase[] = [
  {
    role: 'universityAdmin',
    home: '/university-admin',
    screens: [
      { path: '/university-admin/faculties', shows: FACULTY },
      { path: '/university-admin/groups', shows: GROUP },
      { path: '/university-admin/users', shows: 'Оспанов' },
      { path: '/university-admin/invites' },
      { path: '/university-admin/applications' },
    ],
    foreign: { path: '/platform-admin', expect: '403' },
  },
  {
    role: 'teacher',
    home: '/teacher',
    screens: [
      // Расписание преподавателя сначала просит выбрать группу — данных до выбора нет.
      { path: '/teacher/schedule', shows: 'Выберите группу' },
      { path: '/teacher/groups', shows: GROUP },
      { path: '/teacher/gradebook' },
      { path: '/teacher/materials' },
    ],
    foreign: { path: '/dean', expect: '403' },
  },
  {
    role: 'starosta',
    home: '/',
    screens: [
      { path: '/starosta/group', shows: 'Оспанов' },
      { path: '/starosta/invites' },
      { path: '/starosta/applications' },
      { path: '/schedule', shows: SUBJECT },
    ],
    foreign: { path: '/teacher', expect: '403' },
  },
  {
    role: 'securityGuard',
    home: '/security',
    screens: [{ path: '/security/rooms' }, { path: '/security/cameras' }],
    foreign: { path: '/schedule', expect: 'home' },
  },
  {
    role: 'librarian',
    home: '/library',
    screens: [
      { path: '/library/catalog' },
      { path: '/library/loans' },
      { path: '/library/issue' },
      { path: '/library/reservations' },
    ],
    foreign: { path: '/chats', expect: 'home' },
  },
  {
    role: 'employer',
    home: '/employer',
    screens: [
      // Профиль компании переехал в профиль работодателя; старый адрес ведёт туда.
      { path: '/employer/company', landsAt: '/profile', shows: 'ТОО «Стажировки E2E»' },
      { path: '/employer/access', shows: UNIVERSITY },
      { path: '/employer/vacancies' },
      { path: '/employer/candidates' },
      { path: '/employer/team' },
    ],
    foreign: { path: '/university-admin', expect: '403' },
  },
]

/** Экран открылся сам по себе: не 403, не экран сбоя, не выброс на вход. */
async function expectScreen(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL((url) => url.pathname === path)
  await expect(page.getByRole('main').first()).toBeVisible()
  await expect(page.getByText('Недостаточно прав')).toBeHidden()
  await expect(page.getByText('Что-то пошло не так')).toBeHidden()
}

for (const { role, home, screens, foreign } of CASES) {
  test.describe(`роль ${role}`, () => {
    // Один вход на роль: тесты описания идут подряд в одном контексте.
    test.describe.configure({ mode: 'serial' })

    let context: BrowserContext

    test.beforeAll(async ({ browser }) => {
      context = await signedInContext(browser, role)
    })

    test.afterAll(async () => {
      await context?.close()
    })

    const open = async (body: (page: Page) => Promise<void>) =>
      freshPage(context, async (page) => body(page))

    test('вход ведёт на домашнюю страницу роли', async () => {
      await open(async (page) => {
        await page.goto('/')
        await expectScreen(page, home)
      })
    })

    for (const screen of screens) {
      test(`экран ${screen.path}`, async () => {
        await open(async (page) => {
          await page.goto(screen.path)
          await expectScreen(page, screen.landsAt ?? screen.path)
          if (screen.shows) {
            await expect(page.getByText(screen.shows).first()).toBeVisible()
          }
        })
      })
    }

    test(`чужой экран ${foreign.path} закрыт`, async () => {
      await open(async (page) => {
        await page.goto(foreign.path)
        if (foreign.expect === 'home') {
          await expect(page).toHaveURL((url) => url.pathname === home)
        } else {
          await expect(page.getByText('Недостаточно прав')).toBeVisible()
        }
        await expect(page).not.toHaveURL(/\/login/)
      })
    })
  })
}
