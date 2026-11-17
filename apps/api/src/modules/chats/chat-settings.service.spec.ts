import { DEFAULT_CHAT_REACTION } from '@studenthub/shared-config'
import { ChatSettingsUpdateSchema } from '@studenthub/shared-schemas'
import { ChatSettingsService } from './chat-settings.service'

function setup(stored: string | null = null) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ chatDefaultReaction: stored }),
      update: jest.fn(({ data }: { data: { chatDefaultReaction: string | null } }) =>
        Promise.resolve({ chatDefaultReaction: data.chatDefaultReaction }),
      ),
    },
  }
  const realtime = { emitToUser: jest.fn() }
  return { service: new ChatSettingsService(prisma as never, realtime as never), prisma, realtime }
}

describe('ChatSettingsService', () => {
  it('без своей реакции отдаёт общую по умолчанию', async () => {
    const { service } = setup(null)
    await expect(service.get('u1')).resolves.toEqual({ defaultReaction: DEFAULT_CHAT_REACTION })
  })

  it('отдаёт свою реакцию, если она выбрана', async () => {
    const { service } = setup('👍')
    await expect(service.get('u1')).resolves.toEqual({ defaultReaction: '👍' })
  })

  it('нет пользователя — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.user.findUnique.mockResolvedValueOnce(null)
    await expect(service.get('u1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('сохраняет свою реакцию и шлёт её своим устройствам', async () => {
    const { service, prisma, realtime } = setup()
    await expect(service.update('u1', { defaultReaction: '❤️' })).resolves.toEqual({
      defaultReaction: '❤️',
    })
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { chatDefaultReaction: '❤️' } }),
    )
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:settings-changed', {
      defaultReaction: '❤️',
    })
  })

  it('общая по умолчанию и null хранятся как NULL', async () => {
    const { service, prisma } = setup('👍')
    await service.update('u1', { defaultReaction: DEFAULT_CHAT_REACTION })
    await service.update('u1', { defaultReaction: null })
    for (const call of prisma.user.update.mock.calls) {
      expect(call[0].data).toEqual({ chatDefaultReaction: null })
    }
  })

  it('схема пускает ровно один эмодзи', () => {
    expect(ChatSettingsUpdateSchema.safeParse({ defaultReaction: '👍🏽' }).success).toBe(true)
    expect(ChatSettingsUpdateSchema.safeParse({ defaultReaction: null }).success).toBe(true)
    expect(ChatSettingsUpdateSchema.safeParse({ defaultReaction: '👍👍' }).success).toBe(false)
    expect(ChatSettingsUpdateSchema.safeParse({ defaultReaction: 'ok' }).success).toBe(false)
    expect(ChatSettingsUpdateSchema.safeParse({}).success).toBe(false)
  })
})
