import { Role } from '@studenthub/shared-types'
import { TelegramHookService } from './telegram-hook.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { SupportService } from '../chats/support.service'
import type { ComplaintsService } from '../complaints/complaints.service'

// Вебхук — единственное место, куда пишет чужая система. Проверяем ровно то, что делает
// его безопасным: секрет, отсутствие доверия к телу запроса и молчание при отказах.

function setup(env: Record<string, string | undefined> = {}) {
  const prisma = {
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
  const support = { assign: jest.fn().mockResolvedValue({ assigneeId: 'staff-1' }) }
  const complaints = { take: jest.fn().mockResolvedValue({ takenBy: 'staff-1' }) }
  const service = new TelegramHookService(
    prisma as unknown as PrismaService,
    config as never,
    support as unknown as SupportService,
    complaints as unknown as ComplaintsService,
  )
  return { service, prisma, support, complaints }
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
