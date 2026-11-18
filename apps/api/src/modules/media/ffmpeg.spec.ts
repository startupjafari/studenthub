import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractFrame, FfmpegError, probe, transcodeAnimation, transcodeHls } from './ffmpeg'
import { planHlsLadder } from './media-plan'

// Настоящий ffmpeg: проверяем, что команда перекодирования собрана правильно и ffmpeg её
// принимает. Без бинарника (локальная машина без ffmpeg) набор пропускается — в CI и в
// образе API ffmpeg есть.
function available(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const suite = available() ? describe : describe.skip

suite('ffmpeg (настоящий бинарник)', () => {
  let dir: string
  let source: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'media-spec-'))
    source = join(dir, 'source.mp4')
    // 6 секунд вертикального 540×960 со звуком — проверяем поворот лесенки и аудио.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=540x960:rate=25:duration=6',
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
      source,
    ])
  }, 60_000)

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('probe видит размеры, длительность и звук', async () => {
    const meta = await probe('ffprobe', source)
    expect(meta).toMatchObject({ width: 540, height: 960, hasAudio: true })
    expect(meta.durationMs).toBeGreaterThan(5500)
  })

  it('кадр постера извлекается в JPEG', async () => {
    const out = join(dir, 'poster.jpg')
    await extractFrame('ffmpeg', source, 1, out)
    expect(readFileSync(out).subarray(0, 2).toString('hex')).toBe('ffd8')
  })

  it('HLS: рендишн на каждую ступень, сегменты по 4 с, плейлисты VOD', async () => {
    const renditions = planHlsLadder(540, 960)
    expect(renditions.map((r) => r.short)).toEqual([360, 480])
    const out = join(dir, 'hls')
    await transcodeHls({
      ffmpeg: 'ffmpeg',
      input: source,
      outDir: out,
      renditions,
      hasAudio: true,
      timeoutMs: 120_000,
    })

    for (const r of renditions) {
      const files = readdirSync(join(out, String(r.short)))
      expect(files).toContain('index.m3u8')
      expect(files.filter((f) => /^seg-\d{4}\.ts$/.test(f)).length).toBeGreaterThanOrEqual(2)
      const playlist = readFileSync(join(out, String(r.short), 'index.m3u8'), 'utf8')
      expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
      expect(playlist).toContain('#EXT-X-ENDLIST')
      expect(playlist).toMatch(/^seg-0000\.ts$/m)
      // Сегмент — наш собственный выход (mpegts), а не вход пользователя: probe() его не
      // примет по белому списку контейнеров, поэтому проверяем ffprobe напрямую.
      const seg = JSON.parse(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_streams',
          join(out, String(r.short), 'seg-0000.ts'),
        ]).toString(),
      ) as { streams: { codec_type: string; width?: number; height?: number }[] }
      const video = seg.streams.find((st) => st.codec_type === 'video')
      expect(video).toMatchObject({ width: r.width, height: r.height })
      expect(seg.streams.some((st) => st.codec_type === 'audio')).toBe(true)
    }
  }, 180_000)

  it('webm (matroska) разбирается так же, как mp4', async () => {
    const webm = join(dir, 'source.webm')
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=10:duration=1',
      '-c:v',
      'libvpx-vp9',
      webm,
    ])
    await expect(probe('ffprobe', webm)).resolves.toMatchObject({ width: 320, height: 240 })
  }, 60_000)

  // F-F26: плейлист, загруженный «как видео», не должен открывать файлы по ссылкам внутри.
  it('плейлист HLS со ссылкой на локальный файл не разбирается', async () => {
    const evil = join(dir, 'evil.m3u8')
    writeFileSync(
      evil,
      '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/hostname\n#EXT-X-ENDLIST\n',
    )
    await expect(probe('ffprobe', evil)).rejects.toBeInstanceOf(FfmpegError)
    await expect(extractFrame('ffmpeg', evil, 0, join(dir, 'evil.jpg'))).rejects.toBeInstanceOf(
      FfmpegError,
    )
  })

  describe('GIF → MP4 (анимация)', () => {
    // Маленький GIF нечётного размера: 101×77, 12 кадров/с, 2 секунды; правая половина кадра
    // прозрачная — проверяем белую подложку.
    let gif: string
    beforeAll(() => {
      gif = join(dir, 'source.gif')
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        "testsrc2=size=101x77:rate=12:duration=2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(X,50),0,255)'",
        '-vf',
        'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128',
        gif,
      ])
    }, 60_000)

    const encode = async (out: string, fps: number | null) => {
      await transcodeAnimation({
        ffmpeg: 'ffmpeg',
        inputPath: gif,
        outPath: out,
        width: 100,
        height: 76,
        fps,
        maxSeconds: 60,
        crf: 23,
        timeoutMs: 60_000,
      })
    }

    it('даёт H.264 yuv420p без звука, с индексом в начале и таймингом GIF', async () => {
      const out = join(dir, 'animation.mp4')
      await encode(out, null)
      const meta = await probe('ffprobe', out)
      expect(meta).toMatchObject({ width: 100, height: 76, hasAudio: false })
      expect(meta.durationMs).toBeGreaterThan(1800)
      expect(meta.durationMs).toBeLessThan(2300)
      const streams = JSON.parse(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_streams',
          out,
        ]).toString(),
      ) as { streams: { codec_name: string; pix_fmt: string; nb_frames: string }[] }
      expect(streams.streams).toHaveLength(1)
      expect(streams.streams[0]).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p' })
      // Кадры GIF не размножаются под чужую частоту: 24 кадра за 2 секунды так и остаются.
      expect(Number(streams.streams[0]?.nb_frames)).toBe(24)
      // +faststart: атом moov лежит раньше mdat.
      const head = readFileSync(out)
      expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat'))
    }, 60_000)

    it('прозрачные точки ложатся на белую подложку', async () => {
      const out = join(dir, 'alpha.mp4')
      await encode(out, null)
      const pixel = execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        out,
        '-frames:v',
        '1',
        '-vf',
        'crop=8:8:88:30,scale=1:1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ])
      expect(pixel[0]).toBeGreaterThan(240)
    }, 60_000)

    it('потолок частоты прореживает кадры', async () => {
      const out = join(dir, 'capped.mp4')
      await encode(out, 6)
      const frames = execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_frames',
        '-of',
        'csv=p=0',
        out,
      ])
        .toString()
        .trim()
      expect(Number(frames)).toBe(12)
    }, 60_000)

    it('вход — только GIF: ролик под видом GIF не разбирается', async () => {
      await expect(
        transcodeAnimation({
          ffmpeg: 'ffmpeg',
          inputPath: source,
          outPath: join(dir, 'nope.mp4'),
          width: 100,
          height: 100,
          fps: null,
          maxSeconds: 60,
          crf: 23,
          timeoutMs: 60_000,
        }),
      ).rejects.toBeInstanceOf(FfmpegError)
    })
  })
})
