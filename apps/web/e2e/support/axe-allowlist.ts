import type { Audience } from '../ui-audit/routes'

// Известные нарушения axe уровня serious/critical, которые пока не валят a11y-axe.e2e.ts.
//
// Это НЕ отключение правил. Каждая запись — долг с адресом: какое правило, на каких экранах
// и (если нарушение живёт в одном компоненте) на каком элементе, почему пока терпим и что
// чинить. Запись намеренно узкая — правило без экранов и элемента сюда не пишется: такая
// запись молча проглотила бы и новые нарушения того же правила на любом другом экране.
//
// Починил — удали запись. Нарушение, которого больше нет, отчёт помечает в сводке, но тест
// на нём не падает: часть находок зависит от данных стенда (пустой список против заполненного).

export interface AxeFinding {
  zone: Audience
  route: string
  viewport: 'mobile' | 'desktop'
  rule: string
  impact: string
  help: string
  elements: number
  /** Селекторы всех элементов с нарушением — чтобы было куда идти править. */
  targets: string[]
  /** Причина из allowlist, если нарушение известно и пока терпится. */
  allowed?: string
}

export interface AxeAllowance {
  /** Правило axe (`violation.id`). */
  rule: string
  /**
   * Экраны, на которых нарушение известно. `/x/*` — экран с динамическим сегментом
   * (`/profile/[id]`): id на каждом прогоне свой, поэтому записывается шаблоном.
   */
  routes: string[]
  /** Сузить до зоны, если тот же экран у другой роли чист. */
  zone?: Audience
  /**
   * Подстрока селектора элемента. Задана — запись покрывает находку, только если ВСЕ её
   * элементы под неё подходят: новый элемент с тем же нарушением тест уронит.
   */
  target?: string
  /** Почему пока терпим и что чинить — обязательно, без этого запись не принимается. */
  reason: string
}

// Причины — по одной на корень проблемы: одно и то же нарушение общего компонента всплывает
// на десятках экранов, и объяснять его в каждой записи заново незачем. Найдено первым прогоном
// обхода по всем экранам 2026-10-23 (150 экранов, 11 зон).

const CONTRAST =
  'Контраст текста ниже 4.5:1. Источники — общие компоненты, а не экраны: активная вкладка ' +
  'нижней навигации (text-primary на bg-foreground/[0.08], widgets/app-shell/ui/app-shell.tsx), ' +
  'заголовки групп сайдбара (text-muted-foreground/70, app-sidebar.tsx) и активный пункт ' +
  '(bg-primary/10), аватары-заглушки (белый текст на bg-*-500, shared/ui/avatar.tsx), бейджи ' +
  'статусов (text-success/-warning/-info/-destructive на своём /10-фоне). Починить: поднять ' +
  'токены палитры (DESIGN_SYSTEM, theme-contrast.test.ts) и удалить записи color-contrast.'

const BUTTON_NAME =
  'Кнопка без доступного имени: выпадающий фильтр роли в таблице пользователей ' +
  '(SelectTrigger без aria-label, widgets/users-table/ui/users-table.tsx), кнопка-иконка ' +
  'календаря, превью в витрине дизайн-системы. Починить: aria-label из i18n.'

const PROGRESS =
  'role=progressbar без доступного имени (полоска заполненности профиля и настройки вуза, ' +
  'примеры в витрине). Починить: aria-label или aria-labelledby на полоске.'

const SCROLL =
  'Прокручиваемая область недоступна с клавиатуры (горизонтальная лента/таблица внутри ' +
  '<main> без tabindex и фокусируемых детей). Починить: tabIndex={0} + role=region с подписью.'

const PROHIBITED =
  'aria-label на элементе без роли (иконка-значок в шапке профиля). Починить: role=img ' +
  'либо перенести подпись на родителя.'

const DEFINITION_LIST =
  'Пары <dt>/<dd> в карточках профиля обёрнуты в лишние элементы и выпадают из <dl>. ' +
  'Починить: <dt>/<dd> прямыми детьми <dl> (допустима обёртка <div> вокруг пары).'

export const AXE_ALLOWLIST: AxeAllowance[] = [
  {
    rule: 'color-contrast',
    zone: 'dean',
    routes: ['/dean', '/dean/chats', '/dean/groups', '/dean/posts', '/dean/schedule'],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'librarian',
    routes: ['/library', '/library/issue', '/library/loans', '/library/reports', '/library/return'],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'platformAdmin',
    routes: [
      '/platform-admin',
      '/platform-admin/demo-requests',
      '/platform-admin/invites',
      '/platform-admin/services',
      '/platform-admin/universities',
      '/platform-admin/users',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'platformModerator',
    routes: [
      '/moderator/platform',
      '/moderator/platform/complaints',
      '/moderator/platform/posts',
      '/moderator/platform/support',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'securityGuard',
    routes: ['/security', '/security/cameras'],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'starosta',
    routes: [
      '/starosta/applications',
      '/starosta/chats',
      '/starosta/classmates',
      '/starosta/group',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'student',
    routes: [
      '/',
      '/_dev/design-system',
      '/calendar',
      '/career',
      '/career/applications',
      '/career/profile',
      '/career/vacancies',
      '/chats',
      '/courses',
      '/profile',
      '/profile/*',
      '/schedule',
      '/settings',
      '/tasks',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'teacher',
    routes: [
      '/teacher',
      '/teacher/chats',
      '/teacher/groups',
      '/teacher/posts',
      '/teacher/schedule',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'universityAdmin',
    routes: [
      '/university-admin',
      '/university-admin/analytics',
      '/university-admin/chats',
      '/university-admin/faculties',
      '/university-admin/library/reports',
      '/university-admin/posts',
      '/university-admin/schedule',
      '/university-admin/services',
      '/university-admin/setup',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'color-contrast',
    zone: 'universityModerator',
    routes: [
      '/moderator/university',
      '/moderator/university/applications',
      '/moderator/university/chats',
      '/moderator/university/complaints',
      '/moderator/university/posts',
    ],
    reason: CONTRAST,
  },
  {
    rule: 'button-name',
    zone: 'platformAdmin',
    routes: ['/platform-admin/users'],
    reason: BUTTON_NAME,
  },
  {
    rule: 'button-name',
    zone: 'platformModerator',
    routes: ['/moderator/platform/users'],
    reason: BUTTON_NAME,
  },
  {
    rule: 'button-name',
    zone: 'student',
    routes: ['/_dev/design-system', '/calendar'],
    reason: BUTTON_NAME,
  },
  {
    rule: 'button-name',
    zone: 'universityModerator',
    routes: ['/moderator/university/users'],
    reason: BUTTON_NAME,
  },
  {
    rule: 'aria-progressbar-name',
    zone: 'student',
    routes: ['/_dev/design-system', '/career/profile'],
    reason: PROGRESS,
  },
  {
    rule: 'aria-progressbar-name',
    zone: 'universityAdmin',
    routes: ['/university-admin'],
    reason: PROGRESS,
  },
  {
    rule: 'scrollable-region-focusable',
    zone: 'student',
    routes: ['/_dev/design-system', '/academic'],
    reason: SCROLL,
  },
  {
    rule: 'scrollable-region-focusable',
    zone: 'universityAdmin',
    routes: ['/university-admin'],
    reason: SCROLL,
  },
  {
    rule: 'aria-prohibited-attr',
    zone: 'student',
    routes: ['/profile', '/profile/*'],
    reason: PROHIBITED,
  },
  {
    rule: 'definition-list',
    zone: 'student',
    routes: ['/profile', '/profile/*'],
    reason: DEFINITION_LIST,
  },
  {
    rule: 'dlitem',
    zone: 'student',
    routes: ['/profile', '/profile/*'],
    reason: DEFINITION_LIST,
  },
]

export function routeMatches(pattern: string, route: string): boolean {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return route === prefix || route.startsWith(`${prefix}/`)
  }
  return pattern === route
}

export function findAllowance(finding: AxeFinding): AxeAllowance | undefined {
  return AXE_ALLOWLIST.find(
    (a) =>
      a.rule === finding.rule &&
      (a.zone === undefined || a.zone === finding.zone) &&
      a.routes.some((pattern) => routeMatches(pattern, finding.route)) &&
      (a.target === undefined || finding.targets.every((t) => t.includes(a.target as string))),
  )
}
