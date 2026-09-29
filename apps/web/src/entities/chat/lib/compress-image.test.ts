import { describe, expect, it, vi, afterEach } from 'vitest'
import { compressImage, compressImages, convertUnsupportedImages } from './compress-image'

function makeFile(name: string, type: string, size = 5_000_000): File {
  const file = new File([new Uint8Array(8)], name, { type })
  // Размер настоящего снимка не подделать восемью байтами, а решение «стоит ли сжимать»
  // принимается именно по нему.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compressImage', () => {
  it('не трогает то, что не является картинкой', async () => {
    const pdf = makeFile('отчёт.pdf', 'application/pdf')
    await expect(compressImage(pdf)).resolves.toBe(pdf)
  })

  it('не трогает анимацию и вектор: в JPEG они потеряют себя', async () => {
    const gif = makeFile('кот.gif', 'image/gif')
    const svg = makeFile('схема.svg', 'image/svg+xml')
    await expect(compressImage(gif)).resolves.toBe(gif)
    await expect(compressImage(svg)).resolves.toBe(svg)
  })

  it('возвращает оригинал, когда браузер не умеет createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const png = makeFile('снимок.png', 'image/png')
    await expect(compressImage(png)).resolves.toBe(png)
  })

  it('возвращает оригинал при ошибке декодирования — отправка важнее экономии', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('broken image'))),
    )
    const png = makeFile('битый.png', 'image/png')
    await expect(compressImage(png)).resolves.toBe(png)
  })

  it('пропускает несжимаемое насквозь, сохраняя порядок', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const files = [makeFile('a.pdf', 'application/pdf'), makeFile('b.png', 'image/png')]
    await expect(compressImages(files)).resolves.toEqual(files)
  })
})

describe('HEIC с айфона', () => {
  /** Декодер, который отдаёт битмап заданного размера, и canvas, отдающий blob заданного веса. */
  function stubBrowser(width: number, height: number, blobSize: number): void {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width, height, close: vi.fn() })),
    )
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob) => void) => cb({ size: blobSize } as Blob),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
  }

  it('переводится в JPEG, даже когда JPEG получается тяжелее оригинала', async () => {
    // HEIC жмёт лучше JPEG, поэтому обычный порог выгоды для него всегда «невыгодно» —
    // а отправить оригинал нельзя вовсе: сервер такой тип не принимает.
    stubBrowser(800, 600, 9_000_000)
    const heic = makeFile('IMG_0001.HEIC', 'image/heic', 3_000_000)
    const out = await compressImage(heic)
    expect(out).not.toBe(heic)
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('IMG_0001.jpg')
  })

  it('узнаётся по расширению, когда браузер не сообщил тип', async () => {
    stubBrowser(800, 600, 100_000)
    const heic = makeFile('IMG_0002.heif', '', 3_000_000)
    const out = await compressImage(heic)
    expect(out.type).toBe('image/jpeg')
  })

  it('в режиме «без сжатия» переводится только HEIC, остальное идёт как есть', async () => {
    stubBrowser(800, 600, 100_000)
    const heic = makeFile('IMG_0003.heic', 'image/heic', 3_000_000)
    const png = makeFile('снимок.png', 'image/png', 3_000_000)
    const [outHeic, outPng] = await convertUnsupportedImages([heic, png])
    expect(outHeic).not.toBe(heic)
    expect(outHeic?.type).toBe('image/jpeg')
    expect(outPng).toBe(png)
  })

  it('браузер не умеет декодировать HEIC → отправляем оригинал, отказ придёт с сервера', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('unsupported'))),
    )
    const heic = makeFile('IMG_0004.heic', 'image/heic', 3_000_000)
    await expect(compressImage(heic)).resolves.toBe(heic)
  })
})
