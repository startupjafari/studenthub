import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../../config/env.schema'
import { OpsMessageBuilder } from '../ops-message.builder'
import type { DigestSnapshot, OpsStatusService } from '../ops-status.service'
import type { TelegramOpsService } from '../telegram-ops.service'
import { DigestCheck } from './digest.check'

// T-11 (docs/TELEGRAM_BOT.md §8): «Одно сообщение: БД и топ таблиц, MinIO и сироты,
// доля 410 у push, зависшие заявки/жалобы/инвайты, активность; только агрегаты».

function digest(overrides: Partial<DigestSnapshot> = {}): DigestSnapshot {
  return {
    database: {
      totalBytes: 1_503_238_553,
      topTables: [
        { table: 'notifications', bytes: 734_003_200 },
        { table: 'messages', bytes: 419_430_400 },
      ],
      weekDeltaBytes: 125_829_120,
    },
    storage: [
      { bucket: 'posts-media', files: 1200, bytes: 5_368_709_120 },
      { bucket: 'avatars', files: 800, bytes: 268_435_456 },
    ],
    orphansRemoved: 14,
    push: { sent: 900, gone: 100, goneShare: 10 },
    backlog: { complaints: 3, applications: 7, invites: 21 },
    activity: { active: 412, registered: 9, errorShare: 0.4 },
    ...overrides,
  }
}

function setup(snapshot = digest()) {
  const telegram = { send: jest.fn(async (_message: unknown) => 1 as number | null) }
  const status = { digest: jest.fn(async () => snapshot) }
  const builder = new OpsMessageBuilder({
    get: jest.fn(() => undefined),
  } as unknown as ConfigService<EnvVars, true>)
  const check = new DigestCheck(
    status as unknown as OpsStatusService,
    builder,
    telegram as unknown as TelegramOpsService,
  )
  return { check, telegram }
}

async function textOf(snapshot?: DigestSnapshot): Promise<string> {
  const { check, telegram } = setup(snapshot ?? digest())
  await check.run()
  return (telegram.send.mock.calls[0]?.[0] as unknown as { text: string }).text
}

describe('DigestCheck', () => {
  it('одно сообщение на все строки, а не строка на находку', async () => {
    const { check, telegram } = setup()

    await check.run()

    expect(telegram.send).toHaveBeenCalledTimes(1)
  })

  it('уходит без звука: сводка — тренд, а не инцидент', async () => {
    const { check, telegram } = setup()

    await check.run()

    expect(telegram.send.mock.calls[0]?.[0]).toMatchObject({ silent: true })
  })

  it('БД: объём в человеческих единицах и дельта к неделе со знаком', async () => {
    const text = await textOf()

    expect(text).toContain('БД: 1.4 ГБ (+120 МБ за неделю)')
    expect(text).toContain('топ: notifications 700 МБ · messages 400 МБ')
  })

  it('первая неделя без базы сравнения — дельту не выдумываем', async () => {
    const text = await textOf(
      digest({ database: { totalBytes: 1024, topTables: [], weekDeltaBytes: null } }),
    )

    expect(text).toContain('БД: 1 КБ')
    expect(text).not.toContain('за неделю')
  })

  it('хранилище: суммарный объём, топ бакетов и сироты за ночь', async () => {
    const text = await textOf()

    expect(text).toContain('Хранилище: 5.3 ГБ в 2 бакетах')
    expect(text).toContain('posts-media 5 ГБ')
    expect(text).toContain('сирот убрано ночью: 14')
  })

  it('уборки ещё не было — строки про сирот нет вовсе', async () => {
    const text = await textOf(digest({ orphansRemoved: null }))

    expect(text).not.toContain('сирот')
  })

  it('push: доля мёртвых подписок — признак мусора в таблице', async () => {
    const text = await textOf()

    expect(text).toContain('Push: 900 доставлено, 100 мёртвых подписок (10%)')
  })

  it('очереди дел важнее техники: жалобы, заявки, инвайты одной строкой', async () => {
    const text = await textOf()

    expect(text).toContain('Ждут человека: жалобы 3 · заявки 7 · инвайты 21')
  })

  it('пустая очередь дел так и написана — «ничего», а не три нуля', async () => {
    const text = await textOf(digest({ backlog: { complaints: 0, applications: 0, invites: 0 } }))

    expect(text).toContain('Ждут человека: ничего')
  })

  it('активность и доля 5xx', async () => {
    const text = await textOf()

    expect(text).toContain('Активность: 412 за сутки, 9 новых, 5xx 0.4%')
  })

  it('в сводке только агрегаты — ни одного идентификатора пользователя', async () => {
    const text = await textOf()

    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(text).not.toContain('@')
  })
})
