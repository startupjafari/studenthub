import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@studenthub/shared-types'
import type { PlatformState } from '../../../entities/platform'

let currentRole: Role | null = Role.STUDENT
let pathname = '/'

// next-intl → ключ как есть; локаль фиксируем, чтобы тексты выбирались предсказуемо.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  usePathname: () => pathname,
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('../../../shared/store', () => ({
  useAppSelector: (select: (s: unknown) => unknown) => select({ auth: { role: currentRole } }),
}))
vi.mock('../../../entities/platform/api/platform-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/platform/api/platform-api')>()
  return { ...actual, fetchPlatformState: vi.fn() }
})

import { fetchPlatformState } from '../../../entities/platform'
import { PlatformGate } from './platform-gate'

const UNTIL = new Date(Date.now() + 30 * 60_000).toISOString()

const EMPTY: PlatformState = {
  maintenance: null,
  banner: null,
  disabledSections: [],
  announcedVersion: null,
  season: { off: false, override: null },
}

function show(state: PlatformState | Error) {
  vi.mocked(fetchPlatformState).mockImplementation(() =>
    state instanceof Error ? Promise.reject(state) : Promise.resolve(state),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PlatformGate>
        <main>Лента</main>
      </PlatformGate>
    </QueryClientProvider>,
  )
}

describe('PlatformGate', () => {
  beforeEach(() => {
    currentRole = Role.STUDENT
    pathname = '/'
    vi.clearAllMocks()
  })

  it('во время техработ показывает заглушку вместо приложения', async () => {
    show({ ...EMPTY, maintenance: { until: UNTIL, message: null, startsAt: null, active: true } })

    expect(await screen.findByText('maintenanceTitle')).toBeInTheDocument()
    expect(screen.queryByText('Лента')).not.toBeInTheDocument()
  })

  it('показывает текст, который написал админ, а не заготовку', async () => {
    show({
      ...EMPTY,
      maintenance: {
        until: UNTIL,
        startsAt: null,
        active: true,
        message: { ru: 'Переезжаем на новый сервер', kk: 'Көшеміз', en: 'Migrating' },
      },
    })

    expect(await screen.findByText('Переезжаем на новый сервер')).toBeInTheDocument()
    expect(screen.queryByText('maintenanceFallback')).not.toBeInTheDocument()
  })

  // Тот, кто чинит, обязан попасть внутрь — и обязан помнить, что режим включён.
  it('платформенного админа пускает в приложение, но предупреждает', async () => {
    currentRole = Role.PLATFORM_ADMIN
    show({ ...EMPTY, maintenance: { until: UNTIL, message: null, startsAt: null, active: true } })

    expect(await screen.findByText('maintenanceStaffNotice')).toBeInTheDocument()
    expect(screen.getByText('Лента')).toBeInTheDocument()
  })

  it('показывает баннер над содержимым, не закрывая его', async () => {
    show({
      ...EMPTY,
      banner: {
        until: UNTIL,
        level: 'INFO',
        roles: [],
        universityIds: [],
        text: { ru: 'Сегодня в 22:00 обновление', kk: 'Бүгін 22:00-де', en: 'Update at 22:00' },
      },
    })

    expect(await screen.findByText('Сегодня в 22:00 обновление')).toBeInTheDocument()
    expect(screen.getByText('Лента')).toBeInTheDocument()
  })

  it('без объявлений ничего не добавляет к странице', async () => {
    show(EMPTY)

    expect(await screen.findByText('Лента')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // Сетевой сбой у одного человека не должен выглядеть как остановка платформы.
  it('при недоступном API показывает приложение, а не заглушку', async () => {
    show(new Error('Network down'))

    expect(await screen.findByText('Лента')).toBeInTheDocument()
    expect(screen.queryByText('maintenanceTitle')).not.toBeInTheDocument()
  })
})

describe('PlatformGate — погашенные разделы', () => {
  beforeEach(() => {
    currentRole = Role.STUDENT
    vi.clearAllMocks()
  })

  it('закрывает страницу погашенного раздела', async () => {
    pathname = '/chats'
    show({ ...EMPTY, disabledSections: ['chats'] })

    expect(await screen.findByText('sectionOffTitle')).toBeInTheDocument()
    expect(screen.queryByText('Лента')).not.toBeInTheDocument()
  })

  it('не трогает соседние разделы', async () => {
    pathname = '/events'
    show({ ...EMPTY, disabledSections: ['chats'] })

    expect(await screen.findByText('Лента')).toBeInTheDocument()
  })

  // Совпадение по границе сегмента: иначе «/chats-archive» уехал бы вместе с «/chats».
  it('не путает раздел с похожим по началу путём', async () => {
    pathname = '/chats-archive'
    show({ ...EMPTY, disabledSections: ['chats'] })

    expect(await screen.findByText('Лента')).toBeInTheDocument()
  })

  // Тот, кто решает вернуть раздел, обязан видеть ту же платформу, что и пользователи.
  it('закрывает раздел и платформенному администратору', async () => {
    currentRole = Role.PLATFORM_ADMIN
    pathname = '/chats'
    show({ ...EMPTY, disabledSections: ['chats'] })

    expect(await screen.findByText('sectionOffTitle')).toBeInTheDocument()
  })
})

describe('PlatformGate — адресный баннер и плановые работы', () => {
  beforeEach(() => {
    currentRole = Role.STUDENT
    pathname = '/'
    vi.clearAllMocks()
  })

  const banner = (over: Partial<NonNullable<PlatformState['banner']>> = {}) => ({
    until: UNTIL,
    level: 'INFO' as const,
    roles: [] as string[],
    universityIds: [] as string[],
    text: { ru: 'Объявление', kk: 'Хабарландыру', en: 'Notice' },
    ...over,
  })

  it('показывает баннер без прицела всем', async () => {
    show({ ...EMPTY, banner: banner() })
    expect(await screen.findByText('Объявление')).toBeInTheDocument()
  })

  it('не показывает баннер чужой роли', async () => {
    show({ ...EMPTY, banner: banner({ roles: ['TEACHER'] }) })

    expect(await screen.findByText('Лента')).toBeInTheDocument()
    expect(screen.queryByText('Объявление')).not.toBeInTheDocument()
  })

  it('показывает баннер своей роли', async () => {
    currentRole = Role.TEACHER
    show({ ...EMPTY, banner: banner({ roles: ['TEACHER'] }) })

    expect(await screen.findByText('Объявление')).toBeInTheDocument()
  })

  // «Преподавателям такого-то вуза» — пересечение, а не объединение.
  it('не показывает баннер чужого вуза даже своей роли', async () => {
    currentRole = Role.STUDENT
    show({ ...EMPTY, banner: banner({ universityIds: ['other-uni'] }) })

    expect(await screen.findByText('Лента')).toBeInTheDocument()
    expect(screen.queryByText('Объявление')).not.toBeInTheDocument()
  })

  // Предупреждение и остановка — разные состояния одного события.
  it('о плановых работах предупреждает, но приложение не закрывает', async () => {
    show({
      ...EMPTY,
      maintenance: { until: UNTIL, message: null, startsAt: UNTIL, active: false },
    })

    // Ждём именно уведомление: «Лента» рендерится сразу, ещё до ответа сервера,
    // и ожидание по ней ничего не гарантирует.
    expect(await screen.findByText('maintenancePlanned')).toBeInTheDocument()
    expect(screen.getByText('Лента')).toBeInTheDocument()
  })
})
