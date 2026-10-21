import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProbe } from './probe.js'

test('успешный ffprobe — камера в сети', () => {
  assert.equal(classifyProbe(0, ''), 'ONLINE')
})

test('401 от камеры — неверный пароль, а не «нет связи»', () => {
  assert.equal(
    classifyProbe(
      1,
      'rtsp://***@nvr:554/x: Server returned 401 Unauthorized (authorization failed)',
    ),
    'AUTH_FAILED',
  )
})

test('прочие ошибки — нет связи', () => {
  assert.equal(classifyProbe(1, 'Connection refused'), 'OFFLINE')
  assert.equal(classifyProbe(null, ''), 'OFFLINE')
})
