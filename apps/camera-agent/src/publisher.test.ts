import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishArgs } from './publisher.js'

test('RTMPS: видео без перекодирования, без звука, сертификат ретранслятора закреплён', () => {
  const args = publishArgs(
    'rtsp://admin:p@10.0.0.5/s',
    { url: 'rtmps://relay.kz:1936/cam/c-1', token: 'a.b.c' },
    '/state/relay-ca.pem',
  )
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 6), [
    '-map',
    '0:v:0',
    '-c:v',
    'copy',
    '-an',
    '-f',
  ])
  assert.ok(args.includes('-tls_verify'))
  assert.equal(args[args.indexOf('-ca_file') + 1], '/state/relay-ca.pem')
  assert.equal(args.at(-1), 'rtmps://relay.kz:1936/cam/c-1?user=agent&pass=a.b.c')
})

test('у входа есть таймаут сокета — пропавшая камера не держит ffmpeg вечно', () => {
  const args = publishArgs('rtsp://h/s', { url: 'rtmp://relay:1935/cam/c-1', token: 't' }, null)
  const timeout = args.indexOf('-timeout')
  assert.ok(timeout >= 0 && timeout < args.indexOf('-i'))
  assert.equal(args[timeout + 1], '10000000')
})

test('без TLS (стенд) проверку сертификата не включаем', () => {
  const args = publishArgs('rtsp://h/s', { url: 'rtmp://relay:1935/cam/c-1', token: 't' }, null)
  assert.ok(!args.includes('-tls_verify'))
})
