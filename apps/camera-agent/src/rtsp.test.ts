import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactUrl, withCredentials } from './rtsp.js'

test('логин и пароль подставляются с экранированием', () => {
  assert.equal(
    withCredentials('rtsp://10.0.0.5:554/Streaming/Channels/102', {
      username: 'admin',
      password: 'p@ss:/1',
    }),
    'rtsp://admin:p%40ss%3A%2F1@10.0.0.5:554/Streaming/Channels/102',
  )
})

test('без учётных данных адрес не меняется', () => {
  assert.equal(withCredentials('rtsp://h/x', null), 'rtsp://h/x')
})

test('в журнал адрес уходит без логина и пароля', () => {
  assert.equal(redactUrl('rtsp://admin:secret@10.0.0.5/x'), 'rtsp://***@10.0.0.5/x')
  assert.equal(redactUrl('rtsp://10.0.0.5/x'), 'rtsp://10.0.0.5/x')
})
