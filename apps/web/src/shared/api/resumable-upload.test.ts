import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FILE_UPLOAD } from '@studenthub/shared-config'

const { put } = vi.hoisted(() => ({ put: vi.fn() }))
vi.mock('axios', () => ({ default: { put } }))

import { uploadResumable } from './resumable-upload'
import { fingerprintOf, isResumable, type ResumeRecord, type ResumeStore } from './upload-resume'

const PART = FILE_UPLOAD.MULTIPART_PART_BYTES

function fileOf(size: number, name = 'lecture.mp4'): File {
  const file = new File(['x'], name, { type: 'video/mp4' })
  Object.defineProperty(file, 'size', { value: size })
  Object.defineProperty(file, 'lastModified', { value: 1_700_000_000_000 })
  Object.defineProperty(file, 'slice', { value: () => new Blob(['x']) })
  return file
}

/** Хранилище в памяти вместо IndexedDB: в jsdom его нет, а тянуть полифил ради теста незачем. */
function memoryStore(seed?: ResumeRecord): ResumeStore & { records: Map<string, ResumeRecord> } {
  const records = new Map<string, ResumeRecord>()
  if (seed) records.set(seed.fingerprint, seed)
  return {
    records,
    load: vi.fn(async (fp: string) => records.get(fp) ?? null),
    save: vi.fn(async (r: ResumeRecord) => void records.set(r.fingerprint, r)),
    drop: vi.fn(async (fp: string) => void records.delete(fp)),
  }
}

function steps(partCount: number) {
  return {
    start: vi.fn().mockResolvedValue({
      key: 'user-1/a.mp4',
      uploadId: 'upload-1',
      partSize: PART,
      partCount,
    }),
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
}

function seedRecord(file: File, parts: ResumeRecord['parts'], partCount: number): ResumeRecord {
  return {
    fingerprint: fingerprintOf(file, 'CHAT'),
    bucket: 'CHAT',
    key: 'user-1/a.mp4',
    uploadId: 'upload-1',
    partSize: PART,
    partCount,
    parts,
    createdAt: Date.now(),
  }
}

beforeEach(() => {
  put.mockReset()
  put.mockImplementation((url: string) =>
    Promise.resolve({ headers: { etag: `"e${url.split('/').pop()}"` } }),
  )
})

describe('isResumable', () => {
  it('отвергает запись, нарезанную по другому размеру части', () => {
    const file = fileOf(PART * 3)
    const record = { ...seedRecord(file, [], 3), partSize: PART / 2 }
    expect(isResumable(record, file)).toBe(false)
  })

  it('отвергает запись, у которой не сходится число частей с размером файла', () => {
    const file = fileOf(PART * 3)
    expect(isResumable(seedRecord(file, [], 5), file)).toBe(false)
    expect(isResumable(seedRecord(file, [], 3), file)).toBe(true)
  })

  it('отвергает запись с номером части вне диапазона', () => {
    const file = fileOf(PART * 3)
    expect(isResumable(seedRecord(file, [{ part: 9, etag: 'x' }], 3), file)).toBe(false)
  })
})

describe('uploadResumable', () => {
  it('без сохранённого состояния грузит с нуля и запоминает каждую часть', async () => {
    const file = fileOf(PART * 3)
    const store = memoryStore()
    const s = steps(3)

    await uploadResumable({ file, bucket: 'CHAT', ...s, store })

    expect(s.start).toHaveBeenCalled()
    expect(put).toHaveBeenCalledTimes(3)
    // Открытие загрузки + три части.
    expect(store.save).toHaveBeenCalledTimes(4)
    // Дошли до конца — состояние убрано, иначе оно предлагало бы продолжить готовое.
    expect(store.records.size).toBe(0)
  })

  it('продолжает с сохранённого места, не открывая новую загрузку', async () => {
    const file = fileOf(PART * 4)
    const store = memoryStore(
      seedRecord(
        file,
        [
          { part: 1, etag: 'e1' },
          { part: 2, etag: 'e2' },
        ],
        4,
      ),
    )
    const s = steps(4)

    await uploadResumable({ file, bucket: 'CHAT', ...s, store })

    expect(s.start).not.toHaveBeenCalled()
    // Заливаются только недостающие части.
    expect(put).toHaveBeenCalledTimes(2)
    expect(s.complete.mock.calls[0]?.[0].parts).toHaveLength(4)
  })

  it('отбрасывает состояние, нарезанное по-старому, и начинает заново', async () => {
    const file = fileOf(PART * 3)
    const stale = { ...seedRecord(file, [{ part: 1, etag: 'e1' }], 3), partSize: PART / 2 }
    const store = memoryStore(stale)
    const s = steps(3)

    await uploadResumable({ file, bucket: 'CHAT', ...s, store })

    expect(store.drop).toHaveBeenCalledWith(stale.fingerprint)
    expect(s.start).toHaveBeenCalled()
    expect(put).toHaveBeenCalledTimes(3)
  })

  it('начинает заново, если загрузку уже отменила ночная уборка', async () => {
    const file = fileOf(PART * 2)
    const store = memoryStore(seedRecord(file, [{ part: 1, etag: 'e1' }], 2))
    const s = steps(2)
    // Первый заход по сохранённой загрузке упирается в «её больше нет».
    s.urls.mockRejectedValueOnce({ code: 'NOT_FOUND' })

    await uploadResumable({ file, bucket: 'CHAT', ...s, store })

    expect(s.start).toHaveBeenCalledTimes(1)
    expect(s.complete).toHaveBeenCalled()
  })

  it('при обычной сетевой ошибке состояние сохраняется для следующей попытки', async () => {
    const file = fileOf(PART * 2)
    const store = memoryStore(seedRecord(file, [{ part: 1, etag: 'e1' }], 2))
    const s = steps(2)
    s.urls.mockRejectedValue(new Error('network'))

    await expect(uploadResumable({ file, bucket: 'CHAT', ...s, store })).rejects.toThrow()

    // Загрузку заново НЕ открываем и запись не выбрасываем — иначе обрыв связи стоил бы
    // всего залитого.
    expect(s.start).not.toHaveBeenCalled()
    expect(store.records.size).toBe(1)
  })

  it('отпечаток различает файлы и бакеты', () => {
    const a = fileOf(PART, 'a.mp4')
    const b = fileOf(PART, 'b.mp4')
    expect(fingerprintOf(a, 'CHAT')).not.toBe(fingerprintOf(b, 'CHAT'))
    expect(fingerprintOf(a, 'CHAT')).not.toBe(fingerprintOf(a, 'POSTS'))
  })
})
