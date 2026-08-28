import { sanitizeOpsText } from './ops-sanitizer'

// docs/TELEGRAM_BOT.md §7.5. Этот тест — гарантия §0.1.1 и §7.2.2: если он падает,
// значит в служебный чат может уехать персональная информация или секрет. Ослаблять нельзя.
describe('sanitizeOpsText', () => {
  it('вырезает email — он есть почти в каждом payload’е вебхуков', () => {
    const out = sanitizeOpsText('деплой от aigerim.s@univer.kz упал')

    expect(out).not.toContain('aigerim.s@univer.kz')
    expect(out).toContain('деплой от')
  })

  it('вырезает JWT и токен бота', () => {
    const out = sanitizeOpsText(
      'заголовок eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef и бот 123456789:AAH1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v',
    )

    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(out).not.toContain('AAH1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v')
  })

  it('вырезает значение после token/secret/authorization в любом регистре', () => {
    const out = sanitizeOpsText('X-Ops-Secret=super-secret-value; Authorization: Bearer abc.def')

    expect(out).not.toContain('super-secret-value')
    expect(out).not.toContain('abc.def')
  })

  it('срезает секрет из query-строки, но саму ссылку сохраняет', () => {
    const out = sanitizeOpsText('логи https://railway.app/p/1/logs?token=zzz1112223')

    expect(out).toContain('https://railway.app/p/1/logs')
    expect(out).not.toContain('zzz1112223')
  })

  it('вырезает телефон', () => {
    expect(sanitizeOpsText('звонил +7 701 234 56 78')).not.toContain('701')
  })

  it('НЕ трогает то, ради чего канал и существует: короткий SHA, ветку, счётчики, дату', () => {
    const text = '🔴 Деплой api — упал\nветка: develop · 2c7a86e · 12 событий · 2026-08-28 21:00'

    expect(sanitizeOpsText(text)).toBe(text)
  })

  it('обрезает длину: Telegram отклонит сообщение длиннее 4096 символов целиком', () => {
    const out = sanitizeOpsText('очень длинный отчёт '.repeat(500))

    expect(out.length).toBeLessThanOrEqual(3501)
    expect(out.endsWith('…')).toBe(true)
  })

  it('схлопывает управляющие символы, ломающие разметку', () => {
    expect(sanitizeOpsText('до\u0007после')).toBe('до после')
  })
})
