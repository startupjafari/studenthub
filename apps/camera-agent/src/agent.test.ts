import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { Agent } from './agent.js'
import type { AgentConfig } from './config.js'

const config: AgentConfig = {
  apiUrl: 'https://x/api/v1',
  token: 'shca_test',
  stateDir: '/tmp',
  probeIntervalMs: 60_000,
}

function agentWith(probe: (url: string) => Promise<'ONLINE' | 'OFFLINE' | 'AUTH_FAILED'>) {
  const pair = generateKeyPairSync('x25519')
  const key = {
    publicRaw: pair.publicKey.export({ format: 'jwk' }).x as string,
    privateJwk: pair.privateKey.export({ format: 'jwk' }),
  }
  return new Agent(config, key, probe)
}

test('новые камеры проверяются сразу после получения конфигурации', async () => {
  const seen: string[] = []
  const agent = agentWith(async (url) => {
    seen.push(url)
    return 'ONLINE'
  })
  agent.apply('r1', true, [{ id: 'cam-1', streamUrl: 'rtsp://h/1', credentialsSealed: null }])
  await agent.probeAll()
  assert.deepEqual(seen.at(-1), 'rtsp://h/1')
  assert.deepEqual(agent.snapshot(), { 'cam-1': 'ONLINE' })
})

test('конверт под чужой ключ — камера в AUTH_FAILED, без обращения к ней', async () => {
  let probed = false
  const agent = agentWith(async () => {
    probed = true
    return 'ONLINE'
  })
  agent.apply('r1', true, [
    { id: 'cam-1', streamUrl: 'rtsp://h/1', credentialsSealed: 'v1.a.b.c.d' },
  ])
  await agent.probeAll()
  assert.equal(probed, false)
  assert.deepEqual(agent.snapshot(), { 'cam-1': 'AUTH_FAILED' })
})

test('модуль выключен — камеры забыты и в отчёт не идут', async () => {
  const agent = agentWith(async () => 'ONLINE')
  agent.apply('r1', true, [{ id: 'cam-1', streamUrl: 'rtsp://h/1', credentialsSealed: null }])
  await agent.probeAll()
  agent.apply('r2', false, [])
  assert.deepEqual(agent.snapshot(), {})
})
