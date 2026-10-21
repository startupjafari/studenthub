import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateKey } from './keys.js'

test('ключ создаётся с правами 600 и переживает перезапуск', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'agent-key-')), 'state')
  const first = loadOrCreateKey(dir)
  assert.equal(first.publicRaw.length, 43)
  assert.equal(statSync(join(dir, 'agent-key.json')).mode & 0o777, 0o600)
  const second = loadOrCreateKey(dir)
  assert.equal(second.publicRaw, first.publicRaw)
})
