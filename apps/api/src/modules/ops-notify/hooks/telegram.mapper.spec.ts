import { mapTelegramUpdate } from './telegram.mapper'

// docs/TELEGRAM_BOT.md §7.5 · §6. Апдейты приходят на КАЖДОЕ сообщение в группе,
// а команд у бота четыре — маппер отсеивает всё остальное.

const update = (text: string, extra: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 10, chat: { id: -1001234567890, type: 'supergroup' }, text, ...extra },
})

describe('mapTelegramUpdate', () => {
  it('команда без аргумента', () => {
    expect(mapTelegramUpdate(update('/status'))).toEqual({
      command: 'status',
      argument: '',
      chatId: '-1001234567890',
    })
  })

  it('команда с аргументом', () => {
    expect(mapTelegramUpdate(update('/quiet 2h'))?.argument).toBe('2h')
  })

  it('в группе Telegram дописывает @имя_бота — это та же команда', () => {
    expect(mapTelegramUpdate(update('/status@studenthub_ops_bot'))?.command).toBe('status')
  })

  it('тема запоминается: ответ обязан прийти туда, где спросили', () => {
    expect(mapTelegramUpdate(update('/queues', { message_thread_id: 7 }))?.threadId).toBe(7)
  })

  it('в общем потоке темы нет — и поля тоже', () => {
    expect(mapTelegramUpdate(update('/queues'))).not.toHaveProperty('threadId')
  })

  it('обычное сообщение командой не считается', () => {
    expect(mapTelegramUpdate(update('деплой прошёл?'))).toBeNull()
  })

  it('правка сообщения команду не исполняет — неожиданное поведение', () => {
    expect(mapTelegramUpdate({ update_id: 2, edited_message: { text: '/quiet 2h' } })).toBeNull()
  })

  it('мусор вместо апдейта не роняет приём', () => {
    expect(mapTelegramUpdate({})).toBeNull()
    expect(mapTelegramUpdate({ message: {} })).toBeNull()
    expect(mapTelegramUpdate({ message: { chat: { id: 1 }, text: '/' } })).toBeNull()
  })
})
