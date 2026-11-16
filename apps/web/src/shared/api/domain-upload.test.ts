import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FILE_UPLOAD } from '@studenthub/shared-config'

const { put, post } = vi.hoisted(() => ({ put: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { put } }))
vi.mock('./instance', () => ({ api: { post } }))

import { uploadToDomain } from './domain-upload'
import type { ResumeRecord, ResumeStore } from './upload-resume'

const PART = FILE_UPLOAD.MULTIPART_PART_BYTES
const BASE = '/materials/m1/files'

function fileOf(size: number, name = 'lecture.mp4', type = 'video/mp4'): File {
  const file = new File(['x'], name, { type })
  // File.size read-only — подменяем, чтобы не аллоцировать сотни мегабайт в тесте.
  Object.defineProperty(file, 'size', { value: size })
  Object.defineProperty(file, 'lastModified', { value: 1_700_000_000_000 })
  Object.defineProperty(file, 'slice', { value: () => new Blob(['x']) })
  return file
}

/** Хранилище докачки в памяти: в jsdom нет IndexedDB. */
function memoryStore(): ResumeStore & { records: Map<string, ResumeRecord> } {
  const records = new Map<string, ResumeRecord>()
  return {
    records,
    load: vi.fn(async (fp: string) => records.get(fp) ?? null),
    save: vi.fn(async (r: ResumeRecord) => void records.set(r.fingerprint, r)),
    drop: vi.fn(async (fp: string) => void records.delete(fp)),
  }
}

/** Ответы api по маршруту — как их отдаёт интерцептор (без конверта). */
function routeApi(partCount: number) {
  post.mockImplementation((url: string, body: unknown) => {
    if (url.endsWith('/multipart/start')) {
      return Promise.resolve({
        data: { key: 'u1/a.mp4', uploadId: 'up-1', partSize: PART, partCount },
      })
    }
    if (url.endsWith('/multipart/urls')) {
      const { from, to } = body as { from: number; to: number }
      const parts = Array.from({ length: to - from + 1 }, (_, i) => ({
        part: from + i,
        url: `http://minio/part/${from + i}`,
      }))
      return Promise.resolve({ data: { parts, expiresAt: 'e' } })
    }
    if (url.endsWith('/multipart/complete')) return Promise.resolve({ data: { id: 'f-multi' } })
    if (url.endsWith('/multipart/abort')) return Promise.resolve({ data: undefined })
    if (url.endsWith('/presign')) {
      return Promise.resolve({ data: { key: 'u1/a.pdf', url: 'http://minio/put', expiresAt: 'e' } })
    }
    if (url.endsWith('/confirm')) return Promise.resolve({ data: { id: 'f-direct' } })
    return Promise.resolve({ data: { id: 'f-buffer' } })
  })
}

function calledRoutes(): string[] {
  return post.mock.calls.map((c) => c[0] as string)
}

beforeEach(() => {
  post.mockReset()
  put.mockReset()
  put.mockImplementation((url: string) =>
    Promise.resolve({ headers: { etag: `"e${url.split('/').pop()}"` } }),
  )
})

describe('uploadToDomain — выбор пути по размеру', () => {
  it('до порога буферной загрузки — одним запросом в api', async () => {
    routeApi(1)
    const res = await uploadToDomain({
      file: fileOf(FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES, 'a.pdf', 'application/pdf'),
      base: BASE,
      scope: 'MATERIALS:m1',
    })
    expect(res).toEqual({ id: 'f-buffer' })
    expect(calledRoutes()).toEqual([BASE])
    expect(post.mock.calls[0]![1]).toBeInstanceOf(FormData)
    expect(put).not.toHaveBeenCalled()
  })

  it('до порога многочастной — одной подписанной ссылкой', async () => {
    routeApi(1)
    const res = await uploadToDomain({
      file: fileOf(FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES, 'a.pdf', 'application/pdf'),
      base: BASE,
      scope: 'MATERIALS:m1',
    })
    expect(res).toEqual({ id: 'f-direct' })
    expect(calledRoutes()).toEqual([`${BASE}/presign`, `${BASE}/confirm`])
    expect(post).toHaveBeenCalledWith(`${BASE}/confirm`, { key: 'u1/a.pdf', name: 'a.pdf' })
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('крупнее — частями через маршруты модуля, а не общий /files', async () => {
    routeApi(6)
    const store = memoryStore()
    const progress: number[] = []
    const res = await uploadToDomain({
      file: fileOf(FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES + 1),
      base: BASE,
      scope: 'MATERIALS:m1',
      store,
      onProgress: (p) => progress.push(p),
    })

    expect(res).toEqual({ id: 'f-multi' })
    expect(post).toHaveBeenCalledWith(`${BASE}/multipart/start`, {
      mime: 'video/mp4',
      size: FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES + 1,
    })
    expect(post).toHaveBeenCalledWith(`${BASE}/multipart/urls`, {
      key: 'u1/a.mp4',
      uploadId: 'up-1',
      from: 1,
      to: 6,
    })
    expect(put).toHaveBeenCalledTimes(6)
    const complete = post.mock.calls.find((c) => c[0] === `${BASE}/multipart/complete`)
    expect(complete?.[1]).toMatchObject({
      key: 'u1/a.mp4',
      uploadId: 'up-1',
      name: 'lecture.mp4',
    })
    expect((complete?.[1] as { parts: unknown[] }).parts).toHaveLength(6)
    expect(calledRoutes().every((r) => r.startsWith(BASE))).toBe(true)
    // Прогресс — в процентах, как у буферного и прямого пути, и доходит до конца.
    expect(progress.at(-1)).toBe(100)
    // Дошли до конца — состояние докачки больше не нужно.
    expect(store.records.size).toBe(0)
  })

  it('без имени файла complete не шлёт пустое name — строгая схема его не примет', async () => {
    routeApi(6)
    await uploadToDomain({
      file: fileOf(FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES + 1, ''),
      base: BASE,
      scope: 'MATERIALS:m1',
      store: memoryStore(),
    })
    const complete = post.mock.calls.find((c) => c[0] === `${BASE}/multipart/complete`)
    expect(complete?.[1]).not.toHaveProperty('name')
  })
})

describe('uploadToDomain — обрыв и отмена', () => {
  it('после обрыва сети повторный выбор файла дозаливает только недостающие части', async () => {
    routeApi(6)
    const store = memoryStore()
    const file = fileOf(PART * 5 + 1)
    // Первая попытка: последняя часть падает все три раза — сеть пропала.
    put.mockImplementation((url: string) =>
      url.endsWith('/6')
        ? Promise.reject(new Error('network'))
        : Promise.resolve({ headers: { etag: `"e${url.split('/').pop()}"` } }),
    )
    await expect(
      uploadToDomain({ file, base: BASE, scope: 'MATERIALS:m1', store }),
    ).rejects.toThrow()
    // Ни abort, ни сборки — загрузка ждёт продолжения.
    expect(calledRoutes()).not.toContain(`${BASE}/multipart/abort`)
    expect(store.records.size).toBe(1)

    // Сеть вернулась: новой загрузки не открываем, льём только недостающую часть.
    post.mockClear()
    put.mockClear()
    put.mockImplementation((url: string) =>
      Promise.resolve({ headers: { etag: `"e${url.split('/').pop()}"` } }),
    )
    const res = await uploadToDomain({ file, base: BASE, scope: 'MATERIALS:m1', store })

    expect(res).toEqual({ id: 'f-multi' })
    expect(calledRoutes()).not.toContain(`${BASE}/multipart/start`)
    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]![0]).toBe('http://minio/part/6')
  })

  it('отмена зовёт abort модуля и не собирает файл', async () => {
    routeApi(6)
    const controller = new AbortController()
    put.mockImplementation(() => {
      controller.abort()
      return Promise.reject(Object.assign(new Error('canceled'), { name: 'CanceledError' }))
    })

    await expect(
      uploadToDomain({
        file: fileOf(PART * 5 + 1),
        base: BASE,
        scope: 'MATERIALS:m1',
        store: memoryStore(),
        signal: controller.signal,
      }),
    ).rejects.toThrow()

    expect(post).toHaveBeenCalledWith(`${BASE}/multipart/abort`, {
      key: 'u1/a.mp4',
      uploadId: 'up-1',
    })
    expect(calledRoutes()).not.toContain(`${BASE}/multipart/complete`)
  })

  it('отмена прямой загрузки не отправляет confirm', async () => {
    routeApi(1)
    const controller = new AbortController()
    put.mockImplementation(async () => {
      controller.abort()
      return { status: 200 }
    })

    await expect(
      uploadToDomain({
        file: fileOf(FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES, 'a.pdf', 'application/pdf'),
        base: BASE,
        scope: 'MATERIALS:m1',
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(calledRoutes()).toEqual([`${BASE}/presign`])
  })
})
