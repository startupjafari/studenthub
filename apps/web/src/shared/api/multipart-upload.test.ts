import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FILE_UPLOAD } from '@studenthub/shared-config'

const { put } = vi.hoisted(() => ({ put: vi.fn() }))
vi.mock('axios', () => ({ default: { put } }))

import { needsMultipartUpload, uploadMultipart, type MultipartTarget } from './multipart-upload'

const PART = FILE_UPLOAD.MULTIPART_PART_BYTES

function fileOf(size: number, name = 'lecture.mp4', type = 'video/mp4'): File {
  const file = new File(['x'], name, { type })
  // File.size read-only — подменяем, чтобы не аллоцировать сотни мегабайт в тесте.
  Object.defineProperty(file, 'size', { value: size })
  // slice в jsdom честный, но резать нечего — важен только вызов с правильными границами.
  Object.defineProperty(file, 'slice', { value: () => new Blob(['x']) })
  return file
}

/** Ответ хранилища на PUT части: ETag в кавычках, как его отдаёт MinIO. */
function ok(etag: string) {
  return { headers: { etag: `"${etag}"` } }
}

function harness(target: Partial<MultipartTarget> = {}) {
  const full: MultipartTarget = {
    key: 'user-1/a.mp4',
    uploadId: 'upload-1',
    partSize: PART,
    partCount: 3,
    ...target,
  }
  const calls = {
    start: vi.fn().mockResolvedValue(full),
    urls: vi.fn().mockImplementation(({ from, to }: { from: number; to: number }) =>
      Promise.resolve(
        Array.from({ length: to - from + 1 }, (_, i) => ({
          part: from + i,
          url: `http://minio/part/${from + i}`,
        })),
      ),
    ),
    complete: vi.fn().mockResolvedValue({ id: 'f1' }),
    abort: vi.fn().mockResolvedValue(undefined),
  }
  return { full, calls }
}

beforeEach(() => {
  put.mockReset()
  put.mockImplementation((url: string) => Promise.resolve(ok(`e${url.split('/').pop()}`)))
})

describe('needsMultipartUpload', () => {
  it('файл ровно на пороге идёт одиночным PUT', () => {
    expect(needsMultipartUpload(FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES)).toBe(false)
    expect(needsMultipartUpload(FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES + 1)).toBe(true)
  })
})

describe('uploadMultipart', () => {
  it('заливает все части и собирает объект по возрастанию номера', async () => {
    const { calls } = harness()

    await uploadMultipart({ file: fileOf(PART * 3), ...calls })

    expect(put).toHaveBeenCalledTimes(3)
    expect(calls.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'user-1/a.mp4',
        uploadId: 'upload-1',
        parts: expect.arrayContaining([
          { part: 1, etag: 'e1' },
          { part: 2, etag: 'e2' },
          { part: 3, etag: 'e3' },
        ]),
      }),
    )
  })

  it('берёт подписи одним диапазоном, а не по запросу на часть', async () => {
    const { calls } = harness({ partCount: 5 })

    await uploadMultipart({ file: fileOf(PART * 5), ...calls })

    expect(calls.urls).toHaveBeenCalledTimes(1)
    expect(calls.urls).toHaveBeenCalledWith(expect.objectContaining({ from: 1, to: 5 }))
  })

  it('при докачке просит подписи только на недостающие части, отдельными диапазонами', async () => {
    const { full, calls } = harness({ partCount: 5 })

    await uploadMultipart({
      file: fileOf(PART * 5),
      ...calls,
      resume: full,
      done: [
        { part: 2, etag: 'e2' },
        { part: 3, etag: 'e3' },
      ],
    })

    expect(calls.start).not.toHaveBeenCalled()
    expect(calls.urls).toHaveBeenCalledTimes(2)
    expect(calls.urls).toHaveBeenCalledWith(expect.objectContaining({ from: 1, to: 1 }))
    expect(calls.urls).toHaveBeenCalledWith(expect.objectContaining({ from: 4, to: 5 }))
    // Уже залитые части не перезаливаются, но в сборку попадают.
    expect(put).toHaveBeenCalledTimes(3)
    expect(calls.complete.mock.calls[0]?.[0].parts).toHaveLength(5)
  })

  it('повторяет упавшую часть и доводит загрузку до конца', async () => {
    const { calls } = harness({ partCount: 1 })
    put.mockReset()
    put
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementation(() => Promise.resolve(ok('e1')))

    await uploadMultipart({ file: fileOf(PART), ...calls })

    expect(put).toHaveBeenCalledTimes(2)
    expect(calls.complete).toHaveBeenCalled()
  })

  it('без ETag падает с подсказкой про CORS — это самая частая причина', async () => {
    const { calls } = harness({ partCount: 1 })
    put.mockReset()
    put.mockResolvedValue({ headers: {} })

    await expect(uploadMultipart({ file: fileOf(PART), ...calls })).rejects.toThrow(/ExposeHeaders/)
    expect(calls.complete).not.toHaveBeenCalled()
  })

  it('прогресс доходит до единицы и не превышает её', async () => {
    const { calls } = harness({ partCount: 3 })
    const seen: number[] = []

    await uploadMultipart({
      file: fileOf(PART * 3),
      ...calls,
      onProgress: (f) => seen.push(f),
    })

    expect(Math.max(...seen)).toBe(1)
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true)
  })

  it('при докачке прогресс стартует не с нуля', async () => {
    const { full, calls } = harness({ partCount: 4 })
    const seen: number[] = []

    await uploadMultipart({
      file: fileOf(PART * 4),
      ...calls,
      resume: full,
      done: [
        { part: 1, etag: 'e1' },
        { part: 2, etag: 'e2' },
      ],
      onProgress: (f) => seen.push(f),
    })

    expect(seen[0]).toBeCloseTo(0.5, 5)
  })

  it('отмена убирает загрузку в хранилище, сетевая ошибка — нет', async () => {
    const { calls } = harness({ partCount: 1 })
    put.mockReset()
    put.mockRejectedValue(new Error('network'))

    await expect(uploadMultipart({ file: fileOf(PART), ...calls })).rejects.toThrow()
    // Загрузка жива: на ней держится докачка, отменять её из-за обрыва нельзя.
    expect(calls.abort).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadMultipart({ file: fileOf(PART), ...calls, signal: controller.signal }),
    ).rejects.toThrow()
    expect(calls.abort).toHaveBeenCalledWith({ key: 'user-1/a.mp4', uploadId: 'upload-1' })
  })
})
