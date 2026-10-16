import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/analytics/api/analytics-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/analytics/api/analytics-api')>()
  return { ...actual, fetchUniversitiesSize: vi.fn() }
})
vi.mock('../../../entities/university/api/university-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/university/api/university-api')>()
  return { ...actual, fetchUniversityStats: vi.fn(), fetchUniversityOptions: vi.fn() }
})
// Справочник КАТО ходит в сеть — здесь он не предмет проверки.
vi.mock('../../../entities/kato', () => ({
  useKatoNames: () => ({ nameOf: (code: string | null) => (code ? 'Алматы' : null) }),
}))

import { fetchUniversitiesSize, type UniversitySize } from '../../../entities/analytics'
import { fetchUniversityOptions, fetchUniversityStats } from '../../../entities/university'
import { TooltipProvider } from '../../../shared/ui'
import { PlatformStatsView } from './platform-stats-view'

function uni(id: string, name: string, over: Partial<UniversitySize> = {}): UniversitySize {
  return {
    id,
    name,
    shortName: null,
    status: 'ACTIVE',
    city: null,
    students: 0,
    teachers: 0,
    total: 0,
    faculties: 0,
    groups: 0,
    rooms: 0,
    ...over,
  }
}

const ITEMS = [
  uni('u2', 'Большой университет', {
    city: '750000000',
    students: 1050,
    teachers: 80,
    total: 1135,
    faculties: 4,
    groups: 47,
    rooms: 31,
  }),
  uni('u1', 'Малый институт', { status: 'PENDING', students: 10, total: 11 }),
]

const TOTALS = {
  universities: 2,
  active: 1,
  faculties: 4,
  groups: 47,
  rooms: 31,
  students: 1060,
  teachers: 80,
  total: 1146,
}

// Берём настоящие ru-строки: тест заодно ловит пропавший ключ.
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  return render(<PlatformStatsView />, { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom не знает ResizeObserver, а таблица меряет им полосу прокрутки.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PlatformStatsView', () => {
  it('строит таблицу из одного агрегата, без запроса на каждый вуз', async () => {
    vi.mocked(fetchUniversitiesSize).mockResolvedValue({ items: ITEMS, totals: TOTALS })
    setup()

    expect(await screen.findByText('Большой университет')).toBeInTheDocument()
    expect(screen.getByText('Малый институт')).toBeInTheDocument()
    expect(screen.getByText('Алматы')).toBeInTheDocument()
    // Счётчики пришли вместе со строкой: группы и аудитории — из того же ответа.
    expect(screen.getAllByText('47').length).toBeGreaterThan(0)
    expect(screen.getAllByText('31').length).toBeGreaterThan(0)

    // Прежняя схема — справочник вузов и `GET /universities/:id/stats` на каждый —
    // выедала пользовательский лимит API на сотне вузов.
    expect(fetchUniversitiesSize).toHaveBeenCalledTimes(1)
    expect(fetchUniversityStats).not.toHaveBeenCalled()
    expect(fetchUniversityOptions).not.toHaveBeenCalled()
    expect(screen.getByText('Вузов: 2')).toBeInTheDocument()
    expect(screen.getByText('Людей всего: 1146')).toBeInTheDocument()
  })

  it('итоги берёт с сервера и прямо говорит, что список обрезан', async () => {
    vi.mocked(fetchUniversitiesSize).mockResolvedValue({
      items: ITEMS,
      totals: { ...TOTALS, universities: 250, active: 240, groups: 9000 },
    })
    setup()

    expect(await screen.findByText('Большой университет')).toBeInTheDocument()
    // Плитки — итоги всей платформы, а не сумма двух показанных строк.
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText('240')).toBeInTheDocument()
    expect(screen.getByText('9000')).toBeInTheDocument()
    expect(screen.getByText('Показано вузов: 2 из 250, крупнейшие первыми')).toBeInTheDocument()
  })
})
