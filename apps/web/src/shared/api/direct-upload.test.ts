import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FILE_UPLOAD } from '@studenthub/shared-config'

const { put } = vi.hoisted(() => ({ put: vi.fn() }))
vi.mock('axios', () => ({ default: { put } }))

import { needsDirectUpload, uploadDirect } from './direct-upload'

const THRESHOLD = FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES

function fileOf(size: number, name = 'diploma.pdf', type = 'application/pdf'): File {
  const file = new File(['x'], name, { type })
  // File.size read-only — подменяем для проверки выбора пути без аллокации мегабайт.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('needsDirectUpload', () => {
  it('файл ровно на пороге идёт буферным путём', () => {
    expect(needsDirectUpload(THRESHOLD)).toBe(false)
  })

  it('файл больше порога — только прямой путь', () => {
    // Именно этот случай раньше был тупиком: до порога загрузка шла, выше — отказ.
    expect(needsDirectUpload(THRESHOLD + 1)).toBe(true)
  })
})

describe('uploadDirect', () => {
  beforeEach(() => {
    put.mockReset()
    put.mockResolvedValue({ status: 200 })
  })

  it('идёт по шагам presign → PUT → confirm и возвращает результат confirm', async () => {
    const presign = vi.fn(async () => ({
      key: 'user-1/abc.pdf',
      url: 'http://minio/put?sig=1',
      expiresAt: '2026-08-20T12:00:00.000Z',
    }))
    const confirm = vi.fn(async (key: string, name?: string) => ({ id: 'f1', key, name }))

    const result = await uploadDirect({ file: fileOf(THRESHOLD * 2), presign, confirm })

    expect(presign).toHaveBeenCalledWith('application/pdf')
    // PUT уходит по подписанной ссылке напрямую в хранилище, минуя наш api.
    expect(put).toHaveBeenCalledWith('http://minio/put?sig=1', expect.anything(), expect.anything())
    // Ключ в confirm — тот, что выдал сервер; клиент его не придумывает.
    expect(confirm).toHaveBeenCalledWith('user-1/abc.pdf', 'diploma.pdf')
    expect(result).toEqual({ id: 'f1', key: 'user-1/abc.pdf', name: 'diploma.pdf' })
  })

  it('не подтверждает загрузку, если PUT в хранилище не удался', async () => {
    put.mockRejectedValue(new Error('network'))
    const confirm = vi.fn()

    await expect(
      uploadDirect({
        file: fileOf(THRESHOLD * 2),
        presign: async () => ({ key: 'k', url: 'u', expiresAt: 'e' }),
        confirm,
      }),
    ).rejects.toThrow('network')
    // Иначе появилась бы запись File без объекта в MinIO.
    expect(confirm).not.toHaveBeenCalled()
  })

  it('передаёт Content-Type файла, а без типа — octet-stream', async () => {
    await uploadDirect({
      file: fileOf(THRESHOLD * 2, 'noext', ''),
      presign: async (mime) => {
        expect(mime).toBe('application/octet-stream')
        return { key: 'k', url: 'u', expiresAt: 'e' }
      },
      confirm: async () => ({ ok: true }),
    })

    expect(put.mock.calls[0]?.[2]).toMatchObject({
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  })
})
