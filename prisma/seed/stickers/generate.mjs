// Генератор собственного набора стикеров StudentHub: простые «пузыри» и плашки в палитре
// платформы с короткими студенческими фразами. Чужие стикеры копировать нельзя — набор
// рисуется здесь же, из SVG, и результат (PNG 512×512) лежит в репозитории рядом.
//
// Запуск (после правки фраз или цветов): `node prisma/seed/stickers/generate.mjs`.
// Картинки и манифест `stickers.json` перезаписываются; заливает их `pnpm db:seed:stickers`.
//
// Текст рисуется шрифтом из системы (generic `sans-serif` через fontconfig). Результат
// коммитится, поэтому на машине, где сид только заливает набор, шрифты не нужны.

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { STICKERS } from './stickers.data.mjs'

// sharp есть в зависимостях apps/api — резолвим оттуда, как и остальной сид.
const requireFromApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url))
const sharp = requireFromApi('sharp')

const SIZE = 512
const OUT_DIR = fileURLToPath(new URL('./', import.meta.url))

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Контур формы: пузырь с хвостиком, плашка-«значок» или круг. Белая обводка — как у стикера. */
function shapeSvg(shape, fill) {
  const stroke = 'stroke="#ffffff" stroke-width="18" stroke-linejoin="round"'
  if (shape === 'circle') {
    return `<circle cx="256" cy="256" r="214" fill="${fill}" ${stroke}/>`
  }
  if (shape === 'badge') {
    return `<rect x="40" y="96" width="432" height="320" rx="72" fill="${fill}" ${stroke}/>`
  }
  // Пузырь: скруглённый прямоугольник и хвостик слева снизу одним контуром.
  return `<path d="M112 72 H400 a72 72 0 0 1 72 72 V320 a72 72 0 0 1 -72 72 H200
    L118 452 L132 392 H112 a72 72 0 0 1 -72 -72 V144 a72 72 0 0 1 72 -72 Z"
    fill="${fill}" ${stroke}/>`
}

/** Галочка рисуется контуром: символ ✓ есть не в каждом шрифте. */
function checkSvg(x, y, color) {
  return `<path d="M${x} ${y} l26 26 l50 -56" fill="none" stroke="${color}" stroke-width="18"
    stroke-linecap="round" stroke-linejoin="round"/>`
}

function stickerSvg(sticker) {
  const { lines, color, textColor = '#ffffff', shape = 'bubble', check = false } = sticker
  const centerY = shape === 'bubble' ? 232 : 256
  // Кегль подбирается под самую длинную строку: жирный sans-serif в кириллице — около
  // 0.66 em на знак, ширина под текст — ~360 px у пузыря и плашки, ~320 px у круга.
  const room = shape === 'circle' ? 320 : 360
  const longest = Math.max(...lines.map((line) => line.length))
  const fitted = Math.floor(room / (longest * 0.66))
  const fontSize = Math.min(sticker.fontSize ?? 84, fitted)
  const lineHeight = fontSize * 1.15
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35
  const text = lines
    .map(
      (line, i) =>
        `<text x="256" y="${(firstY + i * lineHeight).toFixed(1)}" text-anchor="middle"
          font-family="sans-serif" font-weight="700" font-size="${fontSize}"
          fill="${textColor}">${escapeXml(line)}</text>`,
    )
    .join('\n')
  const tick = check ? checkSvg(218, firstY + lineHeight * 0.55 + 30, textColor) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.25"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">${shapeSvg(shape, color)}</g>
  ${text}
  ${tick}
</svg>`
}

async function main() {
  const manifest = []
  for (const [order, sticker] of STICKERS.entries()) {
    const file = `${sticker.name}.png`
    const png = await sharp(Buffer.from(stickerSvg(sticker)))
      .resize(SIZE, SIZE)
      // Палитра: у плоской картинки в несколько цветов PNG выходит в разы меньше.
      .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
      .toBuffer()
    writeFileSync(`${OUT_DIR}${file}`, png)
    manifest.push({ file, emoji: sticker.emoji, order, width: SIZE, height: SIZE })
    console.log(`${file}: ${(png.length / 1024).toFixed(1)} КБ`)
  }
  writeFileSync(`${OUT_DIR}stickers.json`, `${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
