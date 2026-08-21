import { Readable } from 'node:stream'
import type { Client as MinioClient } from 'minio'
import { FileService } from './file.service'
import type { PrismaService } from '../../common/prisma/prisma.service'

// Прямая (presigned) загрузка — единственный путь, где API НЕ ВИДИТ содержимого файла.
// Здесь фиксируется, что подтверждение всё равно ничему из запроса не верит: ни ключу,
// ни типу, ни размеру. Ослабление любой из проверок открывает дыру, а не «просто ломает тест».
//
// Детектор типов подменён: `file-type` — ESM-only, и в CommonJS-окружении unit-тестов его
// динамический import падает (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG). Настоящее
// определение по magic bytes проверяется в test/files.integration.e2e-spec.ts на живом MinIO.
jest.mock('./mime-detector', () => ({
  detectAllowedFileType: jest.fn(async (buffer: Buffer) => {
    const head = buffer.toString('latin1', 0, 8)
    if (head.startsWith('%PDF')) {
      return { mime: 'application/pdf', ext: 'pdf', category: 'DOCUMENT' }
    }
    if (buffer[0] === 0x89 && head.includes('PNG')) {
      return { mime: 'image/png', ext: 'png', category: 'IMAGE' }
    }
    // Всё остальное (в т.ч. SVG — его file-type не распознаёт вовсе) — «тип неизвестен».
    return undefined
  }),
}))

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
])
// Именно это пытались бы протащить, объявив тип «application/pdf».
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function setup(options: { head?: Buffer; size?: number; statFails?: boolean } = {}) {
  const minio = {
    statObject: options.statFails
      ? jest.fn().mockRejectedValue(new Error('NoSuchKey'))
      : jest.fn().mockResolvedValue({ size: options.size ?? 20 * 1024 * 1024 }),
    getPartialObject: jest.fn().mockResolvedValue(Readable.from([options.head ?? PDF])),
    removeObject: jest.fn().mockResolvedValue(undefined),
    presignedPutObject: jest.fn().mockResolvedValue('http://minio/put?sig=1'),
  }
  const prisma = {
    file: { create: jest.fn().mockImplementation(({ data }) => ({ id: 'f1', ...data })) },
  }
  const service = new FileService(
    prisma as unknown as PrismaService,
    minio as unknown as MinioClient,
    minio as unknown as MinioClient,
  )
  return { service, minio, prisma }
}

const base = { bucket: 'documents', ownerId: 'user-1' }

describe('FileService.presignPut', () => {
  it('префиксует ключ владельцем — иначе подтверждение нечем привязать к пользователю', async () => {
    const { service } = setup()

    const res = await service.presignPut('documents', 'application/pdf', 'user-1')

    expect(res.key.startsWith('user-1/')).toBe(true)
    expect(res.key.endsWith('.pdf')).toBe(true)
    expect(res.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('FileService.confirmDirectUpload', () => {
  it('создаёт File с типом, определённым по содержимому объекта', async () => {
    const { service } = setup({ head: PDF })

    const file = await service.confirmDirectUpload({ ...base, key: 'user-1/a.pdf' })

    expect(file.mime).toBe('application/pdf')
    expect(file.size).toBe(20 * 1024 * 1024)
  })

  it('отклоняет чужой ключ: подтвердить чужой объект как свой нельзя', async () => {
    const { service, minio, prisma } = setup()

    await expect(
      service.confirmDirectUpload({ ...base, key: 'user-2/secret.pdf' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Чужой объект не трогаем вообще — ни записи, ни удаления.
    expect(prisma.file.create).not.toHaveBeenCalled()
    expect(minio.removeObject).not.toHaveBeenCalled()
  })

  it('нераспознанный тип (SVG под видом PDF) отклоняется и объект удаляется', async () => {
    const { service, minio, prisma } = setup({ head: SVG })

    await expect(
      service.confirmDirectUpload({
        ...base,
        key: 'user-1/a.pdf',
        allowedMimes: new Set(['application/pdf']),
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' })
    expect(prisma.file.create).not.toHaveBeenCalled()
    // В приватном бакете не должно остаться объекта, за который никто не отвечает.
    expect(minio.removeObject).toHaveBeenCalledWith('documents', 'user-1/a.pdf')
  })

  it('картинка вместо документа отклоняется по белому списку модуля', async () => {
    const { service, minio } = setup({ head: PNG })

    await expect(
      service.confirmDirectUpload({
        ...base,
        key: 'user-1/a.png',
        allowedMimes: new Set(['application/pdf']),
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' })
    expect(minio.removeObject).toHaveBeenCalled()
  })

  it('несовпадение категории отклоняется (ожидали изображение — пришёл PDF)', async () => {
    const { service } = setup({ head: PDF })

    await expect(
      service.confirmDirectUpload({ ...base, key: 'user-1/a.pdf', expectedCategory: 'IMAGE' }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' })
  })

  it('размер сверяется с лимитом КАТЕГОРИИ, а не с присланным клиентом', async () => {
    // PNG → категория IMAGE, лимит 10 МБ; в MinIO лежит 12 МБ.
    const { service, minio } = setup({ head: PNG, size: 12 * 1024 * 1024 })

    await expect(
      service.confirmDirectUpload({ ...base, key: 'user-1/big.png' }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect(minio.removeObject).toHaveBeenCalled()
  })

  it('не загруженный объект — NOT_FOUND, а не пустая запись File', async () => {
    const { service, prisma } = setup({ statFails: true })

    await expect(
      service.confirmDirectUpload({ ...base, key: 'user-1/missing.pdf' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.file.create).not.toHaveBeenCalled()
  })

  it('прикладывает материал и имя файла, если модуль их передал', async () => {
    const { service } = setup({ head: PDF })

    const file = await service.confirmDirectUpload({
      ...base,
      key: 'user-1/lecture.pdf',
      materialId: 'mat-1',
      name: 'Лекция 1.pdf',
    })

    expect(file.materialId).toBe('mat-1')
    expect(file.name).toBe('Лекция 1.pdf')
  })
})
