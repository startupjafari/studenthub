import sharp from 'sharp'
import { buildImageVariants, buildPosterVariants } from './image-pipeline'

// Настоящий sharp, без моков: проверяем то, ради чего конвейер существует, — размеры,
// поворот по EXIF, формат копий и вес заглушки.

function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  }).jpeg()
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer()
}

describe('buildImageVariants', () => {
  it('делает WebP-копии по ступеням и LQIP в data-URI', async () => {
    const result = await buildImageVariants(await jpeg(1600, 1200), 'image/jpeg')

    expect(result).toMatchObject({ width: 1600, height: 1200 })
    expect(result.variants.map((v) => v.width)).toEqual([320, 640, 1280])
    expect(result.variants[1]!.height).toBe(480)
    for (const v of result.variants) {
      expect((await sharp(v.buffer).metadata()).format).toBe('webp')
    }
    expect(result.placeholder.startsWith('data:image/webp;base64,')).toBe(true)
    // Заглушка уходит в каждый ответ со списком — она обязана быть крошечной.
    expect(result.placeholder.length).toBeLessThan(1000)
  })

  it('учитывает EXIF-поворот и не переносит метаданные в копии', async () => {
    // Кадр 1200×800, повёрнутый тегом на 90°: показывается как 800×1200.
    const result = await buildImageVariants(await jpeg(1200, 800, 6), 'image/jpeg')

    expect(result).toMatchObject({ width: 800, height: 1200 })
    const first = result.variants[0]!
    expect(first.height).toBeGreaterThan(first.width)
    expect((await sharp(first.buffer).metadata()).exif).toBeUndefined()
  })

  it('GIF — только заглушка, анимацию показывает оригинал', async () => {
    const gif = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#0af' },
    })
      .gif()
      .toBuffer()
    const result = await buildImageVariants(gif, 'image/gif')
    expect(result.variants).toEqual([])
    expect(result.placeholder).toMatch(/^data:image\/webp;base64,/)
  })
})

describe('buildPosterVariants', () => {
  it('постер не шире кадра', async () => {
    const result = await buildPosterVariants(await jpeg(480, 270))
    expect(result.variants.map((v) => v.width)).toEqual([480])
  })
})
