import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.js'

const TOKEN = 'shca_' + 'x'.repeat(43)

test('https и токен — настройки приняты', () => {
  const config = loadConfig({
    STUDENTHUB_API_URL: 'https://api.example.kz/api/v1/',
    STUDENTHUB_AGENT_TOKEN: TOKEN,
  })
  assert.equal(config.apiUrl, 'https://api.example.kz/api/v1')
  assert.equal(config.probeIntervalMs, 60_000)
})

test('http без явного разрешения — отказ: токен не уходит открытым текстом', () => {
  assert.throws(() =>
    loadConfig({
      STUDENTHUB_API_URL: 'http://localhost:3001/api/v1',
      STUDENTHUB_AGENT_TOKEN: TOKEN,
    }),
  )
  assert.doesNotThrow(() =>
    loadConfig({
      STUDENTHUB_API_URL: 'http://localhost:3001/api/v1',
      STUDENTHUB_AGENT_TOKEN: TOKEN,
      STUDENTHUB_ALLOW_INSECURE: '1',
    }),
  )
})

test('не токен агента — отказ с подсказкой', () => {
  assert.throws(
    () =>
      loadConfig({ STUDENTHUB_API_URL: 'https://x/api/v1', STUDENTHUB_AGENT_TOKEN: 'eyJhbGci' }),
    /токен агента/,
  )
})

test('пример из инструкции и обрезанный токен — отказ сразу, а не ошибка запроса', () => {
  for (const token of [
    'shca_…',
    'shca_',
    TOKEN.slice(0, -1),
    `${TOKEN}x`,
    `shca_${'x'.repeat(42)}…`,
  ]) {
    assert.throws(
      () => loadConfig({ STUDENTHUB_API_URL: 'https://x/api/v1', STUDENTHUB_AGENT_TOKEN: token }),
      /целиком/,
      token,
    )
  }
})
