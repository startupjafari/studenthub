import { createHmac } from 'node:crypto'
import { githubSignatureMatches, secretMatches } from './hook-signature'

// docs/TELEGRAM_BOT.md §7.2.1. Эндпоинты приёма вебхуков публичные, поэтому этот тест —
// единственное, что стоит между служебным каналом и кем угодно из интернета.

describe('secretMatches', () => {
  it('совпадающий секрет проходит', () => {
    expect(secretMatches('s3cret-value', 's3cret-value')).toBe(true)
  })

  it('несовпадающий, пустой и отсутствующий — нет', () => {
    expect(secretMatches('другое', 's3cret-value')).toBe(false)
    expect(secretMatches('', 's3cret-value')).toBe(false)
    expect(secretMatches(undefined, 's3cret-value')).toBe(false)
  })

  it('пустой ожидаемый секрет не открывает дверь', () => {
    expect(secretMatches('что-угодно', '')).toBe(false)
  })

  it('префикс верного секрета не проходит — сравнение по всей длине', () => {
    expect(secretMatches('s3cret', 's3cret-value')).toBe(false)
    expect(secretMatches('s3cret-value-и-ещё', 's3cret-value')).toBe(false)
  })
})

describe('githubSignatureMatches', () => {
  const secret = 'webhook-secret'
  const body = Buffer.from('{"action":"completed","workflow_run":{"id":1}}')
  const valid = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('подпись от того же тела и секрета проходит', () => {
    expect(githubSignatureMatches(valid, secret, body)).toBe(true)
  })

  it('подменённое тело ломает подпись — в этом весь смысл HMAC', () => {
    const tampered = Buffer.from('{"action":"completed","workflow_run":{"id":2}}')

    expect(githubSignatureMatches(valid, secret, tampered)).toBe(false)
  })

  it('чужой секрет не подходит', () => {
    expect(githubSignatureMatches(valid, 'другой-секрет', body)).toBe(false)
  })

  it('нет заголовка или нет сырого тела — отказ, а не пропуск', () => {
    expect(githubSignatureMatches(undefined, secret, body)).toBe(false)
    expect(githubSignatureMatches(valid, secret, undefined)).toBe(false)
  })

  it('подпись без префикса sha256= не принимается', () => {
    const bare = createHmac('sha256', secret).update(body).digest('hex')

    expect(githubSignatureMatches(bare, secret, body)).toBe(false)
  })
})
