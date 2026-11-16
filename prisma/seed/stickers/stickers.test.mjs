import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadStickerManifest } from '../steps/95-stickers.mjs'
import { STICKERS } from './stickers.data.mjs'

const DIR = fileURLToPath(new URL('./', import.meta.url))
// Потолок картинки стикера в каталоге (STICKER_LIMITS.MAX_BYTES в shared-schemas).
const MAX_BYTES = 512 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('манифест совпадает с описанием набора и не пуст', () => {
  const manifest = loadStickerManifest()
  assert.equal(manifest.length, STICKERS.length)
  assert.ok(manifest.length >= 12)
  assert.deepEqual(
    manifest.map((s) => s.file),
    STICKERS.map((s) => `${s.name}.png`),
  )
  assert.equal(new Set(manifest.map((s) => s.file)).size, manifest.length)
})

test('каждая картинка — PNG 512×512 не больше 512 КБ, с одним эмодзи', () => {
  for (const item of loadStickerManifest()) {
    const path = `${DIR}${item.file}`
    const bytes = readFileSync(path)
    assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${item.file}: не PNG`)
    // Ширина и высота — в IHDR сразу за сигнатурой и заголовком чанка.
    assert.equal(bytes.readUInt32BE(16), 512, `${item.file}: ширина`)
    assert.equal(bytes.readUInt32BE(20), 512, `${item.file}: высота`)
    assert.ok(statSync(path).size <= MAX_BYTES, `${item.file}: больше 512 КБ`)
    assert.ok(typeof item.emoji === 'string' && item.emoji.length > 0, `${item.file}: эмодзи`)
  }
})
