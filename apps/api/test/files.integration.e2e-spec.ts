import { randomUUID } from 'node:crypto'
import { Client as MinioClient } from 'minio'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { FileService } from '../src/modules/files/file.service'

// Integration-тест (docs/PROJECT.md §17 «FilesService — integration»): реальный MinIO из
// dev-инфраструктуры + тестовая БД. Проверяем round-trip, определение типа по magic bytes,
// лимиты и проверку владения. Изолированный бакет удаляется в конце.

// Валидный 1×1 PNG (сигнатура 89 50 4E 47).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
// Валидный минимальный PDF.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

const TEST_BUCKET = 'test-integration-files'

describe('FileService (integration, реальный MinIO)', () => {
  let prisma: PrismaService
  let minio: MinioClient
  let service: FileService
  let ownerId: string
  let otherUserId: string

  beforeAll(async () => {
    prisma = new PrismaService()
    minio = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
    })
    service = new FileService(prisma, minio)

    if (!(await minio.bucketExists(TEST_BUCKET))) {
      await minio.makeBucket(TEST_BUCKET)
    }

    const owner = await prisma.user.create({
      data: {
        email: `owner-${randomUUID()}@t.io`,
        passwordHash: 'x',
        firstName: 'O',
        lastName: 'Wner',
        role: 'STUDENT',
      },
      select: { id: true },
    })
    ownerId = owner.id
    const other = await prisma.user.create({
      data: {
        email: `other-${randomUUID()}@t.io`,
        passwordHash: 'x',
        firstName: 'Ot',
        lastName: 'Her',
        role: 'STUDENT',
      },
      select: { id: true },
    })
    otherUserId = other.id
  })

  afterAll(async () => {
    // Чистим объекты и бакет.
    const keys: string[] = []
    for await (const obj of minio.listObjectsV2(TEST_BUCKET, '', true)) {
      if (obj.name) keys.push(obj.name)
    }
    if (keys.length) await minio.removeObjects(TEST_BUCKET, keys)
    await minio.removeBucket(TEST_BUCKET)
    // Удаление пользователей каскадно снимает записи File.
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } })
    await prisma.$disconnect()
  })

  it('upload: сохраняет объект в MinIO и запись в БД с типом по содержимому', async () => {
    const file = await service.upload({ buffer: PNG, bucket: TEST_BUCKET, ownerId })

    expect(file.mime).toBe('image/png')
    expect(file.size).toBe(PNG.byteLength)
    expect(file.ownerId).toBe(ownerId)
    expect(file.key).toMatch(/\.png$/)

    // Объект реально лежит в MinIO.
    const stat = await minio.statObject(TEST_BUCKET, file.key)
    expect(stat.size).toBe(PNG.byteLength)
    // Запись есть в БД.
    const row = await prisma.file.findUnique({ where: { id: file.id } })
    expect(row).not.toBeNull()
  })

  it('upload: PDF определяется как application/pdf', async () => {
    const file = await service.upload({ buffer: PDF, bucket: TEST_BUCKET, ownerId })
    expect(file.mime).toBe('application/pdf')
    expect(file.key).toMatch(/\.pdf$/)
  })

  it('getPresignedUrl: URL отдаёт ровно те же байты', async () => {
    const file = await service.upload({ buffer: PNG, bucket: TEST_BUCKET, ownerId })
    const url = await service.getPresignedUrl(file.id, ownerId)
    expect(url).toMatch(/^https?:\/\//)

    const res = await fetch(url)
    expect(res.status).toBe(200)
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(PNG)).toBe(true)
  })

  it('upload: подменённый тип (текст с картинкой-именем) → FILE_TYPE_NOT_ALLOWED', async () => {
    const fake = Buffer.from('это точно не картинка, просто текст')
    await expect(
      service.upload({ buffer: fake, bucket: TEST_BUCKET, ownerId }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' })
  })

  it('upload: изображение больше лимита категории (10 МБ) → FILE_TOO_LARGE', async () => {
    const bigPng = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)])
    await expect(
      service.upload({ buffer: bigPng, bucket: TEST_BUCKET, ownerId }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  it('upload: файл в пределах лимита, но больше порога буфера → FILE_DIRECT_UPLOAD_REQUIRED', async () => {
    // PDF 11 МБ: ≤ лимита DOCUMENT (25 МБ), но > порога буферной загрузки (10 МБ).
    const bigPdf = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)])
    await expect(
      service.upload({ buffer: bigPdf, bucket: TEST_BUCKET, ownerId }),
    ).rejects.toMatchObject({ code: 'FILE_DIRECT_UPLOAD_REQUIRED' })
  })

  it('scope владения: чужой пользователь не получает presigned и не удаляет', async () => {
    const file = await service.upload({ buffer: PNG, bucket: TEST_BUCKET, ownerId })
    await expect(service.getPresignedUrl(file.id, otherUserId)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    await expect(service.delete(file.id, otherUserId)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    // Объект и запись по-прежнему на месте.
    await expect(minio.statObject(TEST_BUCKET, file.key)).resolves.toBeDefined()
  })

  it('delete: удаляет и объект в MinIO, и запись в БД', async () => {
    const file = await service.upload({ buffer: PNG, bucket: TEST_BUCKET, ownerId })
    await service.delete(file.id, ownerId)

    await expect(minio.statObject(TEST_BUCKET, file.key)).rejects.toThrow()
    const row = await prisma.file.findUnique({ where: { id: file.id } })
    expect(row).toBeNull()
  })

  it('getPresignedUrl: несуществующий файл → NOT_FOUND', async () => {
    await expect(service.getPresignedUrl(randomUUID(), ownerId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})
