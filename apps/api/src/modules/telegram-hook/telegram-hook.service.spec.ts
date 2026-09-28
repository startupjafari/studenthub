import { Role } from '@studenthub/shared-types'
import {
  TelegramHookService,
  humanAge,
  nextInRotation,
  parseCommand,
} from './telegram-hook.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { SupportService } from '../chats/support.service'
import type { ComplaintsService } from '../complaints/complaints.service'
import type { PlatformStateReader } from '../platform/platform.constants'

// Вебхук — единственное место, куда пишет чужая система. Проверяем ровно то, что делает
// его безопасным: секрет, отсутствие доверия к телу запроса и молчание при отказах.

function setup(env: Record<string, string | undefined> = {}) {
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    telegramAccount: {
      findFirst: jest.fn().mockResolvedValue({
        user: {
          id: 'staff-1',
          role: Role.PLATFORM_MODERATOR,
          isBlocked: false,
          universityId: null,
          facultyId: null,
          groupId: null,
        },
      }),
    },
  }
  const config = {
    get: jest.fn(
      (key: string) => env[key] ?? (key === 'TELEGRAM_BOT_TOKEN' ? undefined : env[key]),
    ),
  }
  const support = {
    assign: jest.fn().mockResolvedValue({ assigneeId: 'staff-1' }),
    queueStats: jest.fn().mockResolvedValue({ count: 0, oldestAt: null }),
  }
  const complaints = {
    take: jest.fn().mockResolvedValue({ takenBy: 'staff-1' }),
    queueStats: jest.fn().mockResolvedValue({ count: 0, oldestAt: null }),
  }
  const platform = {
    maintenanceActive: jest.fn().mockResolvedValue(false),
    notificationPolicy: jest.fn().mockResolvedValue({
      quietFrom: null,
      quietTo: null,
      muted: [],
      dutyUserId: null,
      digestHour: null,
    }),
    duty: jest.fn().mockResolvedValue({ dutyUserId: null, rotation: [] }),
    rotateDuty: jest.fn().mockResolvedValue(null),
  }
  const redis = { ping: jest.fn().mockResolvedValue('PONG') }
  const minio = { bucketExists: jest.fn().mockResolvedValue(true) }
  const service = new TelegramHookService(
    prisma as unknown as PrismaService,
    config as never,
    support as unknown as SupportService,
    complaints as unknown as ComplaintsService,
    platform as unknown as PlatformStateReader,
    redis as never,
    minio as never,
  )
  return { service, prisma, support, complaints, platform, redis, minio }
}

const query = (data: string) => ({ id: 'cb1', data, from: { id: 12345 } })

describe('TelegramHookService — секрет', () => {
  it('без настроенного секрета вебхук выключен: не совпадает даже пустой заголовок', () => {
    const { service } = setup({})
    expect(service.secretMatches(undefined)).toBe(false)
    expect(service.secretMatches('')).toBe(false)
  })

  it('чужой секрет не проходит', () => {
    const { service } = setup({ TELEGRAM_WEBHOOK_SECRET: 'correct-horse-battery' })
    expect(service.secretMatches('another')).toBe(false)
    expect(service.secretMatches('correct-horse-battery')).toBe(true)
  })
})

describe('TelegramHookService — нажатие', () => {
  it('назначает обращение нажавшему', async () => {
    const { service, support } = setup()
    await service.handleCallback(query('take:ticket:chat-1'))
    expect(support.assign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'staff-1' }),
      'chat-1',
      true,
    )
  })

  it('берёт жалобу в разбор', async () => {
    const { service, complaints } = setup()
    await service.handleCallback(query('take:complaint:c-1'))
    expect(complaints.take).toHaveBeenCalledWith(expect.objectContaining({ sub: 'staff-1' }), 'c-1')
  })

  // Роль и scope читаются из нашей базы по telegramId. Иначе достаточно было бы прислать
  // «я админ» вместе с нажатием.
  it('без привязки не делает ничего', async () => {
    const { service, prisma, support } = setup()
    prisma.telegramAccount.findFirst.mockResolvedValue(null)
    await service.handleCallback(query('take:ticket:chat-1'))
    expect(support.assign).not.toHaveBeenCalled()
  })

  it('обычную роль к квитированию не подпускает', async () => {
    const { service, prisma, support } = setup()
    prisma.telegramAccount.findFirst.mockResolvedValue({
      user: {
        id: 'u1',
        role: Role.STUDENT,
        isBlocked: false,
        universityId: null,
        facultyId: null,
        groupId: null,
      },
    })
    await service.handleCallback(query('take:ticket:chat-1'))
    expect(support.assign).not.toHaveBeenCalled()
  })

  it('заблокированного не подпускает', async () => {
    const { service, prisma, support } = setup()
    prisma.telegramAccount.findFirst.mockResolvedValue({
      user: {
        id: 'staff-1',
        role: Role.PLATFORM_ADMIN,
        isBlocked: true,
        universityId: null,
        facultyId: null,
        groupId: null,
      },
    })
    await service.handleCallback(query('take:ticket:chat-1'))
    expect(support.assign).not.toHaveBeenCalled()
  })

  // Обновление, на которое не ответили 200, Telegram повторяет часами: отказ сервиса —
  // это текст человеку, а не исключение наружу.
  it('отказ сервиса не превращается в исключение', async () => {
    const { service, support } = setup()
    support.assign.mockRejectedValue(new AppException('CONFLICT', 'Обращение уже разбирает другой'))
    await expect(service.handleCallback(query('take:ticket:chat-1'))).resolves.toBeUndefined()
  })

  it('незнакомая кнопка никого не трогает', async () => {
    const { service, support, complaints } = setup()
    await service.handleCallback(query('delete:everything:now'))
    expect(support.assign).not.toHaveBeenCalled()
    expect(complaints.take).not.toHaveBeenCalled()
  })
})

// ── Команды в переписке ──────────────────────────────────────────────────────

/** Что бот отправил: перехватываем fetch, наружу он всё равно не ходит. */
function captureSend() {
  const sent: { method: string; body: Record<string, unknown> }[] = []
  const spy = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const method = String(url).split('/').pop() ?? ''
    sent.push({ method, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return new Response('{}', { status: 200 })
  })
  return { sent, restore: () => spy.mockRestore() }
}

const privateMsg = (text: string) => ({
  text,
  from: { id: 12345 },
  chat: { id: 12345, type: 'private' },
})

describe('parseCommand', () => {
  it('срезает имя бота, которое Telegram дописывает', () => {
    expect(parseCommand('/queue@StudentHubPlatform')).toBe('queue')
  })

  it('обычный текст считает просьбой о помощи, а не мусором', () => {
    expect(parseCommand('привет')).toBe('help')
  })

  it('на пустое сообщение не отвечает вовсе', () => {
    expect(parseCommand(undefined)).toBeNull()
    expect(parseCommand('   ')).toBeNull()
  })
})

describe('nextInRotation', () => {
  it('идёт по кругу', () => {
    expect(nextInRotation({ dutyUserId: 'b', rotation: ['a', 'b', 'c'] })).toBe('c')
    expect(nextInRotation({ dutyUserId: 'c', rotation: ['a', 'b', 'c'] })).toBe('a')
  })

  it('дежурного назначили мимо очереди — следующим считается первый', () => {
    expect(nextInRotation({ dutyUserId: 'x', rotation: ['a', 'b'] })).toBe('a')
  })

  it('пустая очередь не выдумывает дежурного', () => {
    expect(nextInRotation({ dutyUserId: null, rotation: [] })).toBeNull()
  })
})

describe('humanAge', () => {
  it('минуты, часы и сутки', () => {
    expect(humanAge(20 * 60_000)).toBe('20 мин')
    expect(humanAge(5 * 3_600_000)).toBe('5 ч')
    expect(humanAge(70 * 3_600_000)).toBe('2 сут')
  })
})

describe('TelegramHookService — команды', () => {
  it('постороннему не отвечает ни одним числом', async () => {
    const { service, prisma, complaints, support } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    prisma.telegramAccount.findFirst.mockResolvedValue(null)
    const cap = captureSend()

    await service.handleMessage(privateMsg('/queue'))

    // Очередь даже не спрашивали: незачем, ответ всё равно один.
    expect(complaints.queueStats).not.toHaveBeenCalled()
    expect(support.queueStats).not.toHaveBeenCalled()
    expect(String(cap.sent[0]?.body.text)).toContain('не привязан')
    cap.restore()
  })

  it('в группе молчит: рядом с сотрудником там посторонние', async () => {
    const { service, complaints } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    const cap = captureSend()

    await service.handleMessage({
      text: '/queue',
      from: { id: 1 },
      chat: { id: -100, type: 'supergroup' },
    })

    expect(cap.sent).toHaveLength(0)
    expect(complaints.queueStats).not.toHaveBeenCalled()
    cap.restore()
  })

  it('на /start отвечает справкой, а не молчанием', async () => {
    const { service } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    const cap = captureSend()

    await service.handleMessage(privateMsg('/start'))

    expect(cap.sent[0]?.method).toBe('sendMessage')
    expect(String(cap.sent[0]?.body.text)).toContain('/queue')
    cap.restore()
  })

  it('/queue отвечает числами и возрастом самого старого', async () => {
    const { service, complaints, support } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    complaints.queueStats.mockResolvedValue({
      count: 3,
      oldestAt: new Date(Date.now() - 5 * 3_600_000),
    })
    support.queueStats.mockResolvedValue({ count: 1, oldestAt: new Date() })
    const cap = captureSend()

    await service.handleMessage(privateMsg('/queue'))

    const text = String(cap.sent[0]?.body.text)
    expect(text).toContain('Жалоб в очереди: 3')
    expect(text).toContain('Открытых обращений: 1')
    expect(text).toContain('Старейшее ждёт: 5 ч')
    cap.restore()
  })

  it('на пустой очереди не пишет про возраст', async () => {
    const { service } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    const cap = captureSend()

    await service.handleMessage(privateMsg('/queue'))

    expect(String(cap.sent[0]?.body.text)).not.toContain('Старейшее')
    cap.restore()
  })

  it('/status докладывает об упавшей зависимости', async () => {
    const { service, redis } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    redis.ping.mockRejectedValue(new Error('down'))
    const cap = captureSend()

    await service.handleMessage(privateMsg('/status'))

    expect(String(cap.sent[0]?.body.text)).toContain('Не отвечает: Redis')
    cap.restore()
  })

  it('сбой запроса не оставляет человека без ответа', async () => {
    const { service, complaints } = setup({ TELEGRAM_BOT_TOKEN: 't' })
    complaints.queueStats.mockRejectedValue(new Error('база легла'))
    const cap = captureSend()

    await service.handleMessage(privateMsg('/queue'))

    expect(String(cap.sent[0]?.body.text)).toContain('Не получилось')
    cap.restore()
  })
})
