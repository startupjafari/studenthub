import { describe, expect, it, vi, afterEach } from 'vitest'
import { compressImage, compressImages } from './compress-image'

function makeFile(name: string, type: string, size = 5_000_000): File {
  const file = new File([new Uint8Array(8)], name, { type })
  // Размер настоящего снимка не подделать восемью байтами, а решение «стоит ли сжимать»
  // принимается именно по нему.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

afterEach(() => {
  vi.unstubAllGlobals()
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
