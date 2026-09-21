import { createHmac } from 'node:crypto'
import { INIT_DATA_MAX_AGE_MS, verifyInitData } from './init-data'

// Тесты подписи — не формальность: ошибка здесь не видна ни в логах, ни глазами, а
// означает вход под чужим аккаунтом. Поэтому проверяется и успех, и каждый вид отказа.

const BOT_TOKEN = '123456:AAHtest-token-for-specs'

/** Собирает валидную строку initData так же, как это делает Telegram. */
function makeInitData(
  overrides: Record<string, string> = {},
  { authDate = new Date(), token = BOT_TOKEN } = {},
): string {
  const params: Record<string, string> = {
    auth_date: String(Math.floor(authDate.getTime() / 1000)),
    query_id: 'AAH_test',
    user: JSON.stringify({ id: 7215551234, first_name: 'Мехман', username: 'mehmanjafari' }),
    ...overrides,
  }

  const checkString = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secret).update(checkString).digest('hex')

  return new URLSearchParams({ ...params, hash }).toString()
}

describe('verifyInitData', () => {
  it('принимает строку, подписанную нашим токеном, и отдаёт пользователя', () => {
    const result = verifyInitData(makeInitData(), BOT_TOKEN)

    expect(result).toMatchObject({
      ok: true,
      user: { id: 7215551234n, firstName: 'Мехман', username: 'mehmanjafari' },
    })
  })

  it('отвергает строку, подписанную ЧУЖИМ токеном — это главный сценарий подделки', () => {
    const foreign = makeInitData({}, { token: '999999:BBforeign-bot' })

    expect(verifyInitData(foreign, BOT_TOKEN)).toEqual({ ok: false, reason: 'signature' })
  })

  it('отвергает подмену данных при сохранённой подписи', () => {
    const valid = makeInitData()
    const params = new URLSearchParams(valid)
    // Подпись оставляем прежней, а пользователя подменяем на чужого.
    params.set('user', JSON.stringify({ id: 1, first_name: 'Чужой' }))

    expect(verifyInitData(params.toString(), BOT_TOKEN)).toEqual({ ok: false, reason: 'signature' })
  })

  it('отвергает просроченную строку — иначе подсмотренная работала бы вечно', () => {
    const old = makeInitData({}, { authDate: new Date(Date.now() - INIT_DATA_MAX_AGE_MS - 1000) })

    expect(verifyInitData(old, BOT_TOKEN)).toEqual({ ok: false, reason: 'expired' })
  })

  it('отвергает строку из будущего: сбитые часы или попытка продлить срок', () => {
    const ahead = makeInitData({}, { authDate: new Date(Date.now() + INIT_DATA_MAX_AGE_MS + 1000) })

    expect(verifyInitData(ahead, BOT_TOKEN)).toEqual({ ok: false, reason: 'expired' })
  })

  it('отвергает строку без hash и без user', () => {
    const noHash = new URLSearchParams(makeInitData())
    noHash.delete('hash')
    expect(verifyInitData(noHash.toString(), BOT_TOKEN)).toEqual({ ok: false, reason: 'malformed' })

    const noUser = makeInitData({ user: '' })
    expect(verifyInitData(noUser, BOT_TOKEN)).toEqual({ ok: false, reason: 'no-user' })
  })

  it('читает идентификаторы, выходящие за пределы безопасного целого в JS', () => {
    const huge = '9007199254740993'
    const initData = makeInitData({
      user: JSON.stringify({ id: Number(huge), first_name: 'Большой' }),
    })

    const result = verifyInitData(initData, BOT_TOKEN)

    expect(result.ok).toBe(true)
    // Точность важна: перепутанный последний разряд — это другой человек.
    if (result.ok) expect(typeof result.user.id).toBe('bigint')
  })
})
