import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { Agent } from './agent.js'
import type { AgentConfig } from './config.js'
import { Publisher } from './publisher.js'
import type { CameraConfig } from './api.js'

const config: AgentConfig = {
  apiUrl: 'https://x/api/v1',
  token: 'shca_test',
  stateDir: mkdtempSync(join(tmpdir(), 'agent-state-')),
  probeIntervalMs: 60_000,
}

/** Поддельный ffmpeg: запоминает аргументы, умирает по kill. */
function fakeSpawner(calls: string[][]) {
  return (args: string[]) => {
    calls.push(args)
    const child = new EventEmitter() as unknown as ChildProcess & EventEmitter
    Object.assign(child, {
      stderr: new EventEmitter(),
      kill: () => true,
    })
    return child
  }
}

function agentWith(
  probe: (url: string) => Promise<'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'>,
  spawned: string[][] = [],
) {
  const pair = generateKeyPairSync('x25519')
  const key = {
    publicRaw: pair.publicKey.export({ format: 'jwk' }).x as string,
    privateJwk: pair.privateKey.export({ format: 'jwk' }),
  }
  return new Agent(config, key, probe, new Publisher(fakeSpawner(spawned)))
}

const cam = (id: string, extra: Partial<CameraConfig> = {}): CameraConfig => ({
  id,
  streamUrl: `rtsp://h/${id}`,
  credentialsSealed: null,
  publish: null,
  ...extra,
})

const response = (revision: string, cameras: CameraConfig[], enabled = true) => ({
  revision,
  enabled,
  cameras,
  relayCaPem: 'CA-PEM',
})

test('новые камеры проверяются сразу после получения конфигурации', async () => {
  const seen: string[] = []
  const agent = agentWith(async (url) => {
    seen.push(url)
    return 'ONLINE'
  })
  agent.apply(response('r1', [cam('cam-1')]))
  await agent.probeAll()
  assert.deepEqual(seen.at(-1), 'rtsp://h/cam-1')
  assert.deepEqual(agent.snapshot(), { 'cam-1': 'ONLINE' })
})

test('конверт под чужой ключ — камера в AUTH_FAILED, без обращения к ней', async () => {
  let probed = false
  const agent = agentWith(async () => {
    probed = true
    return 'ONLINE'
  })
  agent.apply(response('r1', [cam('cam-1', { credentialsSealed: 'v1.a.b.c.d' })]))
  await agent.probeAll()
  assert.equal(probed, false)
  assert.deepEqual(agent.snapshot(), { 'cam-1': 'AUTH_FAILED' })
})

test('модуль выключен — камеры забыты и в отчёт не идут', async () => {
  const agent = agentWith(async () => 'ONLINE')
  agent.apply(response('r1', [cam('cam-1')]))
  await agent.probeAll()
  agent.apply(response('r2', [], false))
  assert.deepEqual(agent.snapshot(), {})
})

test('камеру смотрят — поток уходит на ретранслятор, перестали — гаснет', () => {
  const spawned: string[][] = []
  const agent = agentWith(async () => 'ONLINE', spawned)
  const publish = { url: 'rtmps://relay:1936/cam/cam-1', token: 't1' }
  agent.apply(response('r1', [cam('cam-1', { publish })]))
  assert.deepEqual(agent.publishing(), ['cam-1'])
  assert.equal(spawned.length, 1)
  assert.equal(readFileSync(join(config.stateDir, 'relay-ca.pem'), 'utf8'), 'CA-PEM')
  // Тот же просмотр, свежий токен — поток не перезапускается.
  agent.apply(response('r1', [cam('cam-1', { publish: { ...publish, token: 't2' } })]))
  assert.equal(spawned.length, 1)
  agent.apply(response('r2', [cam('cam-1')]))
  assert.deepEqual(agent.publishing(), [])
})

test('модуль выключен — ни один поток не идёт', () => {
  const spawned: string[][] = []
  const agent = agentWith(async () => 'ONLINE', spawned)
  const publish = { url: 'rtmps://relay:1936/cam/cam-1', token: 't1' }
  agent.apply(response('r1', [cam('cam-1', { publish })]))
  agent.apply(response('r2', [cam('cam-1', { publish })], false))
  assert.deepEqual(agent.publishing(), [])
})
