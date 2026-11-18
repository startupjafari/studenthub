import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  StickerSourceError,
  clampSegment,
  cropToPixels,
  encodeAnimatedSticker,
  encodeAnimatedWebpSticker,
  encodeStaticSticker,
  fitStickerSide,
  isAnimatedWebp,
  pickFrames,
  sniffStickerSource,
} from './sticker-encode'

const MAX = 512 * 1024

async function webpMeta(buf: Buffer) {
  return sharp(buf, { animated: true }).metadata()
}

/** Сколько миллисекунд длится анимированный WebP по задержкам кадров. */
function totalMs(delay: number[] | undefined): number {
  return (delay ?? []).reduce((a, b) => a + b, 0)
}

describe('sniffStickerSource', () => {
  it('узнаёт форматы по первым байтам, а не по имени', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#f00f' },
    })
      .png()
      .toBuffer()
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#0f0' } })
      .jpeg()
      .toBuffer()
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
      .webp()
      .toBuffer()
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
      .gif()
      .toBuffer()
    expect(sniffStickerSource(png)).toBe('png')
    expect(sniffStickerSource(jpeg)).toBe('jpeg')
    expect(sniffStickerSource(webp)).toBe('webp')
    expect(sniffStickerSource(gif)).toBe('gif')
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom0000')])
    expect(sniffStickerSource(mp4)).toBe('mp4')
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)])
    expect(sniffStickerSource(webm)).toBe('webm')
    expect(sniffStickerSource(Buffer.from('%PDF-1.7 hello world'))).toBeNull()
    expect(sniffStickerSource(Buffer.from('short'))).toBeNull()
  })
})

describe('геометрия', () => {
  it('большая сторона — ровно 512', () => {
    expect(fitStickerSide(1000, 500)).toEqual({ width: 512, height: 256 })
    expect(fitStickerSide(100, 200)).toEqual({ width: 256, height: 512 })
  })

  it('кадрирование долями не выходит за кадр', () => {
    expect(cropToPixels({ x: 0.5, y: 0.5, w: 1, h: 1 }, 100, 50)).toEqual({
      left: 50,
      top: 25,
      width: 50,
      height: 25,
    })
    expect(cropToPixels(undefined, 10, 20)).toEqual({ left: 0, top: 0, width: 10, height: 20 })
  })

  it('отрезок не длиннее 3 с и внутри ролика', () => {
    expect(clampSegment(0, 10_000, 60_000)).toEqual({ startMs: 0, durationMs: 3000 })
    expect(clampSegment(59_000, 3000, 60_000)).toEqual({ startMs: 59_000, durationMs: 1000 })
    expect(clampSegment(-5, 2000, null)).toEqual({ startMs: 0, durationMs: 2000 })
  })

  it('кадры анимации выбираются по задержкам', () => {
    // 10 кадров по 100 мс: с 250 мс на 300 мс — кадры 2, 3, 4.
    expect(pickFrames(Array(10).fill(100), 10, 250, 300)).toEqual({ first: 2, count: 3 })
    // Нулевые задержки считаются как 100 мс.
    expect(pickFrames(Array(100).fill(0), 100, 0, 5000)).toEqual({ first: 0, count: 30 })
  })
})

describe('encodeStaticSticker', () => {
  it('PNG с прозрачностью → WebP 512 px с альфой', async () => {
    const png = await sharp({
      create: { width: 300, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 100, channels: 4, background: '#e33f' },
          })
            .png()
            .toBuffer(),
          top: 25,
          left: 100,
        },
      ])
      .png()
      .toBuffer()
    const out = await encodeStaticSticker(png)
    expect(out).toMatchObject({ width: 512, height: 256, animated: false })
    expect(sniffStickerSource(out.buffer)).toBe('webp')
    expect(out.buffer.byteLength).toBeLessThanOrEqual(MAX)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.hasAlpha).toBe(true)
  })

  it('маленькая картинка растягивается до 512, JPEG поворачивается по EXIF', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#09f' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const out = await encodeStaticSticker(jpeg)
    // Orientation 6 — поворот на 90°: портрет 40×80 становится альбомом.
    expect(out).toMatchObject({ width: 512, height: 256 })
  })

  it('кадрирование и надпись поверх — на сервере (снимок из переписки)', async () => {
    const photo = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer()
    // Белая надпись на весь стикер: после наложения центр стикера — белый.
    const overlay = await sharp({
      create: { width: 50, height: 50, channels: 4, background: '#ffff' },
    })
      .png()
      .toBuffer()
    const out = await encodeStaticSticker(photo, {
      crop: { x: 0, y: 0, w: 0.5, h: 1 },
      overlay,
    })
    // Половина кадра 400×200 — квадрат 200×200 → 512×512.
    expect(out).toMatchObject({ width: 512, height: 512 })
    const { data } = await sharp(out.buffer)
      .extract({ left: 256, top: 256, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(200)
  })

  it('шумная фотография укладывается в 512 КБ снижением качества', async () => {
    const noise = Buffer.alloc(1024 * 1024 * 4)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
    const png = await sharp(noise, { raw: { width: 1024, height: 1024, channels: 4 } })
      .png()
      .toBuffer()
    const out = await encodeStaticSticker(png)
    expect(out.buffer.byteLength).toBeLessThanOrEqual(MAX)
  })

  it('«бомба» по пикселям отклоняется до декодирования', async () => {
    // PNG 10000×10000 одним цветом — килобайты на диске, 100 Мп в памяти.
    const bomb = await sharp({
      create: { width: 10_000, height: 10_000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer()
    await expect(encodeStaticSticker(bomb)).rejects.toMatchObject({ problem: 'pixels' })
  })

  it('мусор вместо картинки — decode', async () => {
    await expect(encodeStaticSticker(Buffer.from('not an image at all'))).rejects.toBeInstanceOf(
      StickerSourceError,
    )
  })
})

describe('encodeAnimatedWebpSticker', () => {
  async function animatedWebp(frames: number, delay: number): Promise<Buffer> {
    // Кадры разного цвета: одинаковые кодировщик склеил бы в один.
    const pngs = await Promise.all(
      Array.from({ length: frames }, (_, i) =>
        sharp({
          create: {
            width: 64,
            height: 64,
            channels: 4,
            background: { r: (i * 37) % 256, g: (i * 91) % 256, b: 128, alpha: 1 },
          },
        })
          .png()
          .toBuffer(),
      ),
    )
    return sharp(pngs, { join: { animated: true } })
      .webp({ delay: Array(frames).fill(delay), loop: 0 })
      .toBuffer()
  }

  it('берёт не больше 3 с и растягивает до 512', async () => {
    const src = await animatedWebp(60, 100) // 6 с
    expect(await isAnimatedWebp(src)).toBe(true)
    const out = await encodeAnimatedWebpSticker(src, { startMs: 0, durationMs: 10_000 })
    const meta = await webpMeta(out.buffer)
    expect(out.animated).toBe(true)
    expect(meta.width).toBe(512)
    expect(meta.pages).toBe(30)
    expect(totalMs(meta.delay)).toBeLessThanOrEqual(3000)
    expect(out.buffer.byteLength).toBeLessThanOrEqual(MAX)
  }, 60_000)
})

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString()
    return encoders.includes('libwebp_anim')
  } catch {
    return false
  }
}

// Настоящий ffmpeg, как в ffmpeg.spec.ts: без бинарника с libwebp_anim набор пропускается.
const suite = hasFfmpeg() ? describe : describe.skip

suite('encodeAnimatedSticker (настоящий ffmpeg)', () => {
  let dir: string
  let video: string
  let gif: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sticker-spec-'))
    video = join(dir, 'clip.mp4')
    gif = join(dir, 'clip.gif')
    // 6 с, 60 к/с, со звуком: звук должен уйти, частота — упасть до 30, длина — до 3 с.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=60:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      video,
    ])
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=200x200:rate=10:duration=5',
      gif,
    ])
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('видео: отрезок ≤ 3 с, ≤ 30 к/с, 512 px, без звука, ≤ 512 КБ', async () => {
    const work = mkdtempSync(join(dir, 'w-'))
    const out = await encodeAnimatedSticker({
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      input: video,
      kind: 'video',
      workDir: work,
      animation: { startMs: 1000, durationMs: 3000 },
    })
    expect(out).toMatchObject({ width: 512, height: 288, animated: true })
    expect(out.buffer.byteLength).toBeLessThanOrEqual(MAX)
    const meta = await webpMeta(out.buffer)
    expect(meta.pages).toBeLessThanOrEqual(90)
    expect(meta.pages).toBeGreaterThan(1)
    expect(totalMs(meta.delay)).toBeLessThanOrEqual(3100)
    expect(readFileSync(join(work, 'sticker.webp')).toString('ascii', 8, 12)).toBe('WEBP')
  }, 120_000)

  it('видео: кадрирование и надпись поверх', async () => {
    const work = mkdtempSync(join(dir, 'w-'))
    const overlay = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const out = await encodeAnimatedSticker({
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      input: video,
      kind: 'video',
      workDir: work,
      animation: {
        startMs: 0,
        durationMs: 1000,
        crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
        overlay,
      },
    })
    // Кадр 640×360, по ширине половина: 320×360 → 455×512.
    expect(out).toMatchObject({ width: 455, height: 512 })
  }, 120_000)

  it('GIF: анимированный WebP, частота не выше исходной', async () => {
    const work = mkdtempSync(join(dir, 'w-'))
    const out = await encodeAnimatedSticker({
      ffmpeg: 'ffmpeg',
      ffprobe: 'ffprobe',
      input: gif,
      kind: 'gif',
      workDir: work,
      animation: { startMs: 500, durationMs: 3000 },
    })
    const meta = await webpMeta(out.buffer)
    expect(out).toMatchObject({ width: 512, height: 512, animated: true })
    // 10 к/с × 3 с — около 30 кадров, а не 90.
    expect(meta.pages).toBeLessThanOrEqual(31)
    expect(out.buffer.byteLength).toBeLessThanOrEqual(MAX)
  }, 120_000)

  it('не видео и не GIF — decode, ffmpeg не открывает чужой контейнер', async () => {
    const work = mkdtempSync(join(dir, 'w-'))
    const fake = join(dir, 'list.m3u8')
    writeFileSync(fake, '#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n')
    await expect(
      encodeAnimatedSticker({
        ffmpeg: 'ffmpeg',
        ffprobe: 'ffprobe',
        input: fake,
        kind: 'video',
        workDir: work,
        animation: { startMs: 0, durationMs: 1000 },
      }),
    ).rejects.toMatchObject({ problem: 'decode' })
  })
})
