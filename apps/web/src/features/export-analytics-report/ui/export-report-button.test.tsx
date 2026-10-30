import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/analytics/api/analytics-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/analytics/api/analytics-api')>()
  return { ...actual, exportAnalyticsReport: vi.fn() }
})
// Сохранение файла — браузерный API (createObjectURL), которого в jsdom нет.
vi.mock('../../../shared/lib', async (orig) => {
  const actual = await orig<typeof import('../../../shared/lib')>()
  return { ...actual, saveFile: vi.fn() }
})

import { exportAnalyticsReport } from '../../../entities/analytics'
import { saveFile } from '../../../shared/lib'
import { ExportReportButton } from './export-report-button'

const T = ru.AnalyticsReport
const FILE = { blob: new Blob(['x']), filename: 'studenthub_analytics-report_2026-10-23.xlsx' }

function setup(props: { facultyId?: string; disabled?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  return render(<ExportReportButton {...props} />, { wrapper })
}

beforeEach(() => {
  vi.mocked(exportAnalyticsReport).mockReset().mockResolvedValue(FILE)
  vi.mocked(saveFile).mockReset()
})

describe('ExportReportButton', () => {
  it('открывает окно с периодом и форматом, по умолчанию — квартал и Excel', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: T.button }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(T.period)).toHaveTextContent(T.periodQuarter)
    expect(screen.getByLabelText(T.format)).toHaveTextContent(T.formatXlsx)
  })

  it('выгружает файл с выбранной областью и языком интерфейса и закрывает окно', async () => {
    setup({ facultyId: 'fac-1' })
    fireEvent.click(screen.getByRole('button', { name: T.button }))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(FILE))
    expect(exportAnalyticsReport).toHaveBeenCalledWith({
      period: 'quarter',
      format: 'xlsx',
      locale: 'ru',
      facultyId: 'fac-1',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('без выбранного факультета кнопка недоступна', () => {
    setup({ disabled: true })
    expect(screen.getByRole('button', { name: T.button })).toBeDisabled()
  })

  it('ошибка выгрузки оставляет окно открытым и файл не сохраняется', async () => {
    vi.mocked(exportAnalyticsReport).mockRejectedValue({ code: 'RATE_LIMIT', message: '' })
    setup()
    fireEvent.click(screen.getByRole('button', { name: T.button }))
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    await waitFor(() => expect(exportAnalyticsReport).toHaveBeenCalled())
    expect(saveFile).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
