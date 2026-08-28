import type { ConfigService } from '@nestjs/config'
import type { OpsEventSpec } from '../../common/monitoring'
import type { EnvVars } from '../../config/env.schema'
import type { OpsStatusSnapshot } from './ops-status.service'
import { OpsMessageBuilder } from './ops-message.builder'

// Формат канала (docs/TELEGRAM_BOT.md §4.4): первая строка — эмодзи и суть, потому что
// в списке чатов с телефона видно только её.

function setup(env: Partial<EnvVars> = {}) {
  const config = { get: jest.fn((key: keyof EnvVars) => env[key]) }
  return new OpsMessageBuilder(config as unknown as ConfigService<EnvVars, true>)
}

const deployFailed: OpsEventSpec = {
  topic: 'deploy',
  status: 'error',
  title: 'Деплой {service} — упал',
  fields: [{ label: 'ветка', field: 'branch' }, { field: 'sha' }, { field: 'author' }],
  links: [{ label: 'Логи Railway', field: 'logsUrl' }],
}

describe('OpsMessageBuilder', () => {
  it('собирает две строки: статус с сутью и детали через «·»', () => {
    const message = setup().build(deployFailed, {
      service: 'api',
      branch: 'develop',
      sha: '2c7a86e',
      author: 'startupjafari',
    })

    expect(message.text).toBe('🔴 Деплой api — упал\nветка: develop · 2c7a86e · startupjafari')
  })

  it('пропускает поля, которых нет в данных, а не печатает undefined', () => {
    const message = setup().build(deployFailed, { service: 'web', branch: 'main' })

    expect(message.text).toBe('🔴 Деплой web — упал\nветка: main')
  })

  it('без полей вовсе остаётся одна строка', () => {
    const message = setup().build({ topic: 'alerts', status: 'ok', title: 'Всё поднялось' })

    expect(message.text).toBe('🟢 Всё поднялось')
  })

  it('метка окружения печатается для staging и молчит на prod (§3.6)', () => {
    const staging = setup({ OPS_ENV_LABEL: 'staging' }).build(deployFailed, { service: 'api' })
    const prod = setup({ OPS_ENV_LABEL: 'prod' }).build(deployFailed, { service: 'api' })

    expect(staging.text).toBe('🔴 [staging] Деплой api — упал')
    expect(prod.text).toBe('🔴 Деплой api — упал')
  })

  it('тема берётся по topic из переменных окружения (§3.1)', () => {
    const builder = setup({ TELEGRAM_TOPIC_DEPLOY: 4, TELEGRAM_TOPIC_ALERTS: 9 })

    expect(builder.build(deployFailed, {}).threadId).toBe(4)
    expect(builder.build({ topic: 'alerts', status: 'warn', title: 'x' }).threadId).toBe(9)
  })

  it('без заданной темы сообщение идёт в общий поток — деградация, а не отказ', () => {
    expect(setup().build(deployFailed, {}).threadId).toBeUndefined()
  })

  it('кнопка собирается из ссылки', () => {
    const message = setup().build(deployFailed, { logsUrl: 'https://railway.app/logs' })

    expect(message.buttons).toEqual([{ text: 'Логи Railway', url: 'https://railway.app/logs' }])
  })

  it('не-URL кнопкой не становится: битая ссылка — это 400 и потерянное сообщение целиком', () => {
    expect(setup().build(deployFailed, { logsUrl: 'не-ссылка' }).buttons).toEqual([])
    expect(setup().build(deployFailed, { logsUrl: 'javascript:alert(1)' }).buttons).toEqual([])
  })
})

// §3.3: закреплённое сообщение читают взглядом сверху, поэтому у него свой формат —
// но та же метка окружения и та же эмодзи-азбука статусов.
describe('OpsMessageBuilder.buildStatus', () => {
  const snapshot = (overrides: Partial<OpsStatusSnapshot> = {}): OpsStatusSnapshot => ({
    release: '2c7a86e',
    uptimeMs: 26 * 60 * 60_000,
    dependencies: [
      { name: 'postgres', up: true, reason: '' },
      { name: 'redis', up: true, reason: '' },
    ],
    queues: [
      { name: 'email', waiting: 0, active: 0, delayed: 0, failed: 0 },
      { name: 'notifications', waiting: 12, active: 1, delayed: 0, failed: 3 },
    ],
    checkedAt: new Date('2026-08-28T21:05:00Z'),
    ...overrides,
  })

  it('всё поднято — 🟢, версия, аптайм и непустые очереди', () => {
    const text = setup().buildStatus(snapshot()).text

    expect(text).toContain('🟢 StudentHub — статус')
    expect(text).toContain('версия: 2c7a86e · аптайм: 1 д 2 ч')
    expect(text).toContain('postgres 🟢 · redis 🟢')
    expect(text).toContain('очереди: notifications 12/1 ✗3')
    expect(text).toContain('обновлено: 28.08 21:05 UTC')
  })

  it('пустые очереди не занимают экран строкой из нулей', () => {
    const text = setup().buildStatus(
      snapshot({ queues: [{ name: 'email', waiting: 0, active: 0, delayed: 0, failed: 0 }] }),
    ).text

    expect(text).toContain('очереди: пусто')
  })

  it('упавшая зависимость поднимает статус всей шапки в 🔴', () => {
    const text = setup().buildStatus(
      snapshot({ dependencies: [{ name: 'redis', up: false, reason: 'ECONNREFUSED' }] }),
    ).text

    expect(text.startsWith('🔴 StudentHub — статус')).toBe(true)
    expect(text).toContain('redis 🔴')
  })

  it('метка окружения работает и здесь', () => {
    const text = setup({ OPS_ENV_LABEL: 'staging' }).buildStatus(snapshot()).text

    expect(text.startsWith('🟢 [staging] StudentHub — статус')).toBe(true)
  })

  it('уходит без звука и в тему сводок', () => {
    const message = setup({ TELEGRAM_TOPIC_DIGEST: 3 }).buildStatus(snapshot())

    expect(message.silent).toBe(true)
    expect(message.threadId).toBe(3)
  })
})
