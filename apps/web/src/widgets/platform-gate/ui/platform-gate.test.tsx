import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@studenthub/shared-types'
import type { PlatformState } from '../../../entities/platform'

let currentRole: Role | null = Role.STUDENT

// next-intl → ключ как есть; локаль фиксируем, чтобы тексты выбирались предсказуемо.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
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
    vi.clearAllMocks()
  })

  it('во время техработ показывает заглушку вместо приложения', async () => {
    show({ ...EMPTY, maintenance: { until: UNTIL, message: null } })

    expect(await screen.findByText('maintenanceTitle')).toBeInTheDocument()
    expect(screen.queryByText('Лента')).not.toBeInTheDocument()
  })

  it('показывает текст, который написал админ, а не заготовку', async () => {
    show({
      ...EMPTY,
      maintenance: {
        until: UNTIL,
        message: { ru: 'Переезжаем на новый сервер', kk: 'Көшеміз', en: 'Migrating' },
      },
    })

    expect(await screen.findByText('Переезжаем на новый сервер')).toBeInTheDocument()
    expect(screen.queryByText('maintenanceFallback')).not.toBeInTheDocument()
  })

  // Тот, кто чинит, обязан попасть внутрь — и обязан помнить, что режим включён.
  it('платформенного админа пускает в приложение, но предупреждает', async () => {
    currentRole = Role.PLATFORM_ADMIN
    show({ ...EMPTY, maintenance: { until: UNTIL, message: null } })

    expect(await screen.findByText('maintenanceStaffNotice')).toBeInTheDocument()
    expect(screen.getByText('Лента')).toBeInTheDocument()
  })

  it('показывает баннер над содержимым, не закрывая его', async () => {
    show({
      ...EMPTY,
      banner: {
        until: UNTIL,
        level: 'INFO',
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
