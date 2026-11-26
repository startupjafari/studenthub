import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@studenthub/shared-types'
import type { EdsCredentialInfo } from '@studenthub/shared-schemas'

// next-intl → ключ (и параметры через пробел, чтобы проверять подстановку); тосты глушим.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
  useLocale: () => 'ru',
  useFormatter: () => ({ dateTime: () => '12 марта', relativeTime: () => '2 дня назад' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }))

// Сеть и NCALayer — подменяем: проверяем, что рисует строка в каждом состоянии.
vi.mock('../../../shared/api', async (orig) => {
  const actual = await orig<typeof import('../../../shared/api')>()
  return { ...actual, edsConfigRequest: vi.fn() }
})
vi.mock('../../../shared/lib/ncalayer', async (orig) => {
  const actual = await orig<typeof import('../../../shared/lib/ncalayer')>()
  return { ...actual, useNcaLayerSupported: vi.fn(() => true) }
})

import { edsConfigRequest, type MeResponse } from '../../../shared/api'
import { useNcaLayerSupported } from '../../../shared/lib/ncalayer'
import { EdsLinkRow } from './eds-link-row'

const configMock = vi.mocked(edsConfigRequest)
const supportedMock = vi.mocked(useNcaLayerSupported)

const DAY = 24 * 60 * 60 * 1000

const dean: MeResponse = {
  id: 'u1',
  email: 'dean@uni.kz',
  firstName: 'Айгерим',
  lastName: 'Садыкова',
  avatarUrl: null,
  role: Role.DEAN,
  showEmail: false,
  twoFactorEnabled: true,
  universityId: 'un1',
  facultyId: 'f1',
  groupId: null,
  eds: null,
}

function credential(overrides: Partial<EdsCredentialInfo> = {}): EdsCredentialInfo {
  return {
    iinLast4: '1234',
    subjectCn: 'САДЫКОВА АЙГЕРИМ',
    orgBin: '990140000123',
    certNotAfter: new Date(Date.now() + 200 * DAY).toISOString(),
    linkedAt: new Date(Date.now() - 30 * DAY).toISOString(),
    lastUsedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  configMock.mockReset()
  configMock.mockResolvedValue({ enabled: true })
  supportedMock.mockReturnValue(true)
})

describe('EdsLinkRow — вход по ЭЦП в настройках', () => {
  it('роль без права на ЭЦП: строки нет, состояние входа не запрашивается', async () => {
    const { container } = render(<EdsLinkRow me={{ ...dean, role: Role.STUDENT }} />, {
      wrapper,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container).toBeEmptyDOMElement()
    expect(configMock).not.toHaveBeenCalled()
  })

  it('вход по ЭЦП выключен на сервере: строки нет', async () => {
    configMock.mockResolvedValue({ enabled: false })
    const { container } = render(<EdsLinkRow me={dean} />, { wrapper })
    await waitFor(() => expect(configMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('не привязана: кнопка «Привязать», отвязывать нечего', async () => {
    render(<EdsLinkRow me={dean} />, { wrapper })
    expect(await screen.findByRole('button', { name: 'edsLink' })).toBeInTheDocument()
    expect(screen.getByText('edsDesc')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'edsUnlink' })).not.toBeInTheDocument()
  })

  it('«Привязать» открывает окно с подписью в NCALayer; код спрашивается после подписи', async () => {
    const user = userEvent.setup()
    render(<EdsLinkRow me={dean} />, { wrapper })
    await user.click(await screen.findByRole('button', { name: 'edsLink' }))
    expect(await screen.findByRole('button', { name: 'edsSign' })).toBeInTheDocument()
    expect(screen.queryByLabelText('edsCodeLabel')).not.toBeInTheDocument()
  })

  it('привязана: ИИН — только последние цифры, ФИО и БИН из сертификата, перепривязка и отвязка', async () => {
    render(<EdsLinkRow me={{ ...dean, eds: credential() }} />, { wrapper })
    expect(await screen.findByText('edsIinMasked 1234')).toBeInTheDocument()
    expect(screen.getByText('САДЫКОВА АЙГЕРИМ')).toBeInTheDocument()
    expect(screen.getByText('990140000123')).toBeInTheDocument()
    expect(screen.getByText('2 дня назад')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'edsRelink' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'edsUnlink' })).toBeInTheDocument()
    // Срок далеко — предупреждения нет.
    expect(screen.queryByText(/edsCertExpiresIn/)).not.toBeInTheDocument()
    expect(screen.queryByText('edsCertExpired')).not.toBeInTheDocument()
  })

  it('ключ физлица без БИН и без входов: строки БИН нет, «ещё не входили»', async () => {
    render(<EdsLinkRow me={{ ...dean, eds: credential({ orgBin: null, lastUsedAt: null }) }} />, {
      wrapper,
    })
    expect(await screen.findByText('edsNeverUsed')).toBeInTheDocument()
    expect(screen.queryByText('edsBin')).not.toBeInTheDocument()
  })

  it('сертификат истекает меньше чем через 30 дней — предупреждение с числом дней', async () => {
    const soon = new Date(Date.now() + 10 * DAY - 60_000).toISOString()
    render(<EdsLinkRow me={{ ...dean, eds: credential({ certNotAfter: soon }) }} />, { wrapper })
    expect(await screen.findByText('edsCertExpiresIn 10')).toBeInTheDocument()
    expect(screen.getByText('edsCertRenewHint')).toBeInTheDocument()
  })

  it('сертификат истёк — отметка «срок истёк»', async () => {
    const past = new Date(Date.now() - DAY).toISOString()
    render(<EdsLinkRow me={{ ...dean, eds: credential({ certNotAfter: past }) }} />, { wrapper })
    expect(await screen.findByText('edsCertExpired')).toBeInTheDocument()
  })

  it('без своей 2FA привязать нельзя — вместо кнопки объяснение', async () => {
    render(<EdsLinkRow me={{ ...dean, twoFactorEnabled: false }} />, { wrapper })
    expect(await screen.findByText('edsNeed2fa')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'edsLink' })).not.toBeInTheDocument()
  })

  it('на телефоне NCALayer нет: привязка не предлагается, отвязка остаётся', async () => {
    supportedMock.mockReturnValue(false)
    render(<EdsLinkRow me={{ ...dean, eds: credential() }} />, { wrapper })
    expect(await screen.findByText('edsDesktopOnly')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'edsRelink' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'edsUnlink' })).toBeInTheDocument()
  })
})
