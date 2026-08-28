import type { ConfigService } from '@nestjs/config'
import type { OpsNotifier } from '../../common/monitoring'
import type { EnvVars } from '../../config/env.schema'
import type { MigrationsCheck } from './checks/migrations.check'
import type { OpsCommand } from './hooks/telegram.mapper'
import { OpsMessageBuilder } from './ops-message.builder'
import { OpsCommandService } from './ops-command.service'
import type { OpsPolicyService } from './ops-policy.service'
import type { OpsStatusService, OpsStatusSnapshot } from './ops-status.service'
import type { TelegramOpsService } from './telegram-ops.service'

// T-13 (docs/TELEGRAM_BOT.md §8): «Вебхук с secret_token, allowlist по chat_id,
// в ответах нет персональных данных».

const CHAT = '-1001234567890'

const snapshot: OpsStatusSnapshot = {
  release: '2c7a86e',
  uptimeMs: 3 * 60 * 60_000,
  dependencies: [{ name: 'postgres', up: true, reason: '' }],
  queues: [{ name: 'email', waiting: 2, active: 1, delayed: 0, failed: 0 }],
  checkedAt: new Date('2026-08-28T21:05:00Z'),
}

function setup(migrations: { applied: number; pending: string[] } = { applied: 12, pending: [] }) {
  const telegram = { send: jest.fn(async (_m: unknown) => 1 as number | null) }
  const status = {
    snapshot: jest.fn(async () => snapshot),
    queues: jest.fn(async () => snapshot.queues),
  }
  const policy = {
    startQuiet: jest.fn(async (_ms: number) => new Date('2026-08-28T23:00:00Z')),
    endQuiet: jest.fn(async () => ({ total: 12, red: 2 }) as { total: number; red: number } | null),
  }
  const notifier: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const service = new OpsCommandService(
    status as unknown as OpsStatusService,
    { state: jest.fn(async () => migrations) } as unknown as MigrationsCheck,
    policy as unknown as OpsPolicyService,
    new OpsMessageBuilder({ get: jest.fn(() => undefined) } as unknown as ConfigService<
      EnvVars,
      true
    >),
    telegram as unknown as TelegramOpsService,
    { get: jest.fn(() => CHAT) } as unknown as ConfigService<EnvVars, true>,
    notifier,
  )
  return { service, telegram, policy, notifier }
}

const cmd = (command: string, argument = '', chatId = CHAT): OpsCommand => ({
  command,
  argument,
  chatId,
  threadId: 7,
})

const sentText = (telegram: { send: jest.Mock }): string =>
  (telegram.send.mock.calls[0]?.[0] as { text: string }).text

describe('OpsCommandService — allowlist', () => {
  it('команда из чужого чата игнорируется МОЛЧА', async () => {
    const { service, telegram } = setup()

    await service.handle(cmd('status', '', '-100999'))

    // Ответ «недоступно» подтвердил бы чужому, что бот жив и куда-то подключён.
    expect(telegram.send).not.toHaveBeenCalled()
  })
})

describe('OpsCommandService — чтение', () => {
  it('/status отвечает тем же, что в закреплённом сообщении', async () => {
    const { service, telegram } = setup()

    await service.handle(cmd('status'))

    expect(sentText(telegram)).toContain('версия: 2c7a86e')
  })

  it('ответ приходит в ту же тему, где спросили', async () => {
    const { service, telegram } = setup()

    await service.handle(cmd('status'))

    expect(telegram.send.mock.calls[0]?.[0]).toMatchObject({ threadId: 7 })
  })

  it('/queues показывает все очереди, включая пустые', async () => {
    const { service, telegram } = setup()

    await service.handle(cmd('queues'))

    expect(sentText(telegram)).toContain('email: ждут 2 · в работе 1')
  })

  it('/migrations на синхронной БД отвечает «применены», а не молчит', async () => {
    const { service, telegram } = setup({ applied: 12, pending: [] })

    await service.handle(cmd('migrations'))

    expect(sentText(telegram)).toContain('🟢')
    expect(sentText(telegram)).toContain('Миграции применены: 12')
  })

  it('/migrations при расхождении перечисляет неприменённые', async () => {
    const { service, telegram } = setup({ applied: 10, pending: ['20260828_a', '20260829_b'] })

    await service.handle(cmd('migrations'))

    expect(sentText(telegram)).toContain('Неприменённые миграции: 2')
    expect(sentText(telegram)).toContain('20260828_a')
  })

  it('в ответах нет персональных данных — только версии, числа и имена миграций', async () => {
    const { service, telegram } = setup()

    await service.handle(cmd('status'))

    expect(sentText(telegram)).not.toContain('@')
  })

  it('чужая команда в общем чате остаётся без ответа', async () => {
    const { service, telegram } = setup()

    await service.handle(cmd('weather'))

    expect(telegram.send).not.toHaveBeenCalled()
  })
})

describe('OpsCommandService — /quiet', () => {
  it('включает тишину на указанный срок и объявляет об этом', async () => {
    const { service, policy, notifier } = setup()

    await service.handle(cmd('quiet', '2h'))

    expect(policy.startQuiet).toHaveBeenCalledWith(2 * 60 * 60_000)
    expect(notifier.emit).toHaveBeenCalledWith('quietStarted', expect.anything())
  })

  it('минуты по умолчанию: «/quiet 30» это полчаса', async () => {
    const { service, policy } = setup()

    await service.handle(cmd('quiet', '30'))

    expect(policy.startQuiet).toHaveBeenCalledWith(30 * 60_000)
  })

  it('дольше 12 часов не даём — это уже не работы, а забытая команда', async () => {
    const { service, policy, telegram } = setup()

    await service.handle(cmd('quiet', '20h'))

    expect(policy.startQuiet).not.toHaveBeenCalled()
    expect(sentText(telegram)).toContain('Максимум 12 часов')
  })

  it('непонятный аргумент — подсказка, а не молчание', async () => {
    const { service, policy, telegram } = setup()

    await service.handle(cmd('quiet', 'потом'))

    expect(policy.startQuiet).not.toHaveBeenCalled()
    expect(sentText(telegram)).toContain('/quiet 30m')
  })

  it('/quiet off снимает тишину и подводит итог проглоченного', async () => {
    const { service, policy, notifier } = setup()

    await service.handle(cmd('quiet', 'off'))

    expect(policy.endQuiet).toHaveBeenCalled()
    expect(notifier.emit).toHaveBeenCalledWith('quietEnded', {
      summary: '12 событий, из них 2 красных',
    })
  })

  it('/quiet off без тишины отвечает честно', async () => {
    const { service, policy, telegram, notifier } = setup()
    policy.endQuiet.mockResolvedValueOnce(null)

    await service.handle(cmd('quiet', 'off'))

    expect(notifier.emit).not.toHaveBeenCalled()
    expect(sentText(telegram)).toContain('Тишины не было')
  })
})
