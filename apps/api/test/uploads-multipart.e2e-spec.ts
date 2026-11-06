import { Test } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import request from 'supertest'
import { Client as MinioClient } from 'minio'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { AppModule } from '../src/app.module'
import { throttlerStorageStub } from './throttler-storage.stub'
import { PrismaService } from '../src/common/prisma/prisma.service'
import { PasswordService } from '../src/common/security/password.service'

const PASSWORD = 'Passw0rd!'

// 21.B1: многочастная загрузка в материалы, документы и сдачи заданий. Части идут в
// настоящий MinIO мимо приложения — иначе проверять нечего: весь смысл пути в том, что
// байты через API не проходят, а сборку и проверку типа делает сервер.
describe('Многочастная загрузка в модули (e2e, 21.B1)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService
  let passwords: PasswordService
  let server: ReturnType<NestFastifyApplication['getHttpServer']>

  const minio = new MinioClient({
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
  })
  // TRUNCATE чистит БД, но не хранилище: собранные объекты убираем сами, иначе dev-бакеты
  // обрастают мусором от каждого прогона.
  const created: { bucket: string; key: string }[] = []

  // PDF на 12 МБ — две части, минимальный честный многочастный случай (минимум части у S3 —
  // 5 МиБ). PDF подходит всем трём модулям: документ его принимает, материал и сдача — тоже.
  const HEAD = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  const BODY = Buffer.concat([HEAD, Buffer.alloc(12 * 1024 * 1024 - HEAD.byteLength, 0x20)])

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorageStub)
      .compile()

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.setGlobalPrefix('api/v1')
    await app.register(cookie)
    await app.register(multipart, { limits: { files: 10 } })
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    prisma = app.get(PrismaService)
    passwords = app.get(PasswordService)
    server = app.getHttpServer()
  })

  afterAll(async () => {
    for (const { bucket, key } of created) {
      await minio.removeObject(bucket, key).catch(() => undefined)
    }
    await app.close()
  })

  interface World {
    teacherTok: string
    otherTeacherTok: string
    studentTok: string
    strangerTok: string
    materialId: string
    assignmentId: string
  }

  async function makeUser(
    email: string,
    data: { role: string; universityId: string; facultyId?: string; groupId?: string },
  ): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(PASSWORD),
        firstName: 'Имя',
        lastName: 'Фам',
        ...data,
      },
      select: { id: true },
    })
    return u.id
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD })
      .expect(201)
    return res.body.data.accessToken as string
  }

  const auth = (t: string): { Authorization: string } => ({ Authorization: `Bearer ${t}` })

  async function world(): Promise<World> {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE users, universities RESTART IDENTITY CASCADE')
    const uni = await prisma.university.create({ data: { name: 'Uni A' }, select: { id: true } })
    const fac = await prisma.faculty.create({
      data: { name: 'Физфак', universityId: uni.id },
      select: { id: true },
    })
    const group = await prisma.group.create({
      data: { name: 'ФИ-21', facultyId: fac.id },
      select: { id: true },
    })
    const otherGroup = await prisma.group.create({
      data: { name: 'ФИ-22', facultyId: fac.id },
      select: { id: true },
    })
    const teacherId = await makeUser('t@a.io', { role: 'TEACHER', universityId: uni.id })
    await makeUser('t2@a.io', { role: 'TEACHER', universityId: uni.id })
    await makeUser('s@a.io', {
      role: 'STUDENT',
      universityId: uni.id,
      facultyId: fac.id,
      groupId: group.id,
    })
    await makeUser('s2@a.io', {
      role: 'STUDENT',
      universityId: uni.id,
      facultyId: fac.id,
      groupId: otherGroup.id,
    })
    const material = await prisma.material.create({
      data: { teacherId, groupId: group.id, title: 'Лекция 1' },
      select: { id: true },
    })
    const subject = await prisma.subject.create({
      data: { name: 'Физика', universityId: uni.id },
      select: { id: true },
    })
    const course = await prisma.course.create({
      data: { subjectId: subject.id, groupId: group.id, teacherId },
      select: { id: true },
    })
    const assignment = await prisma.assignment.create({
      data: {
        courseId: course.id,
        createdById: teacherId,
        title: 'Лабораторная 1',
        submissionType: 'FILE',
        status: 'PUBLISHED',
      },
      select: { id: true },
    })
    return {
      teacherTok: await login('t@a.io'),
      otherTeacherTok: await login('t2@a.io'),
      studentTok: await login('s@a.io'),
      strangerTok: await login('s2@a.io'),
      materialId: material.id,
      assignmentId: assignment.id,
    }
  }

  /** PUT по подписанной ссылке и ETag из ответа — то же самое делает браузер. */
  async function putSigned(url: string, body: Buffer): Promise<string> {
    const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) })
    expect(res.status).toBe(200)
    return (res.headers.get('etag') ?? '').replace(/"/g, '')
  }

  /**
   * Весь путь start → urls → PUT частей → complete по маршрутам модуля. Возвращает ответ
   * complete; ключ загрузки — для проверок владения.
   */
  async function uploadInParts(
    token: string,
    base: string,
    name: string,
  ): Promise<{ body: Record<string, unknown>; key: string }> {
    const started = await request(server)
      .post(`${base}/multipart/start`)
      .set(auth(token))
      .send({ mime: 'application/pdf', size: BODY.byteLength })
      .expect(201)
    const { key, uploadId, partSize, partCount } = started.body.data as {
      key: string
      uploadId: string
      partSize: number
      partCount: number
    }
    expect(partSize).toBe(FILE_UPLOAD.MULTIPART_PART_BYTES)
    expect(partCount).toBe(2)

    const urls = await request(server)
      .post(`${base}/multipart/urls`)
      .set(auth(token))
      .send({ key, uploadId, from: 1, to: partCount })
      .expect(201)
    const parts: { part: number; etag: string }[] = []
    for (const item of urls.body.data.parts as { part: number; url: string }[]) {
      const offset = (item.part - 1) * partSize
      parts.push({
        part: item.part,
        etag: await putSigned(item.url, BODY.subarray(offset, offset + partSize)),
      })
    }

    const done = await request(server)
      .post(`${base}/multipart/complete`)
      .set(auth(token))
      .send({ key, uploadId, parts, name })
      .expect(201)
    return { body: done.body.data as Record<string, unknown>, key }
  }

  async function track(fileId: string): Promise<{ bucket: string; key: string; size: number }> {
    const row = await prisma.file.findUniqueOrThrow({
      where: { id: fileId },
      select: { bucket: true, key: true, size: true },
    })
    created.push({ bucket: row.bucket, key: row.key })
    return row
  }

  it('материал: файл собирается из частей и сразу прикреплён к материалу', async () => {
    const w = await world()
    const { body } = await uploadInParts(
      w.teacherTok,
      `/api/v1/materials/${w.materialId}/files`,
      'lecture.pdf',
    )

    expect(body).toMatchObject({ mime: 'application/pdf', size: BODY.byteLength })
    const row = await track(body.id as string)
    expect(row.size).toBe(BODY.byteLength)
    const linked = await prisma.file.findUniqueOrThrow({
      where: { id: body.id as string },
      select: { materialId: true, name: true },
    })
    expect(linked).toEqual({ materialId: w.materialId, name: 'lecture.pdf' })
  })

  it('материал: чужой преподаватель загрузку не откроет', async () => {
    const w = await world()
    await request(server)
      .post(`/api/v1/materials/${w.materialId}/files/multipart/start`)
      .set(auth(w.otherTeacherTok))
      .send({ mime: 'application/pdf', size: BODY.byteLength })
      .expect(403)
  })

  it('документ: собранный скан отдаёт id для прикрепления', async () => {
    const w = await world()
    const { body } = await uploadInParts(w.studentTok, '/api/v1/documents/upload', 'diploma.pdf')

    expect(body).toMatchObject({ mime: 'application/pdf', size: BODY.byteLength })
    await track(body.id as string)
  })

  it('документ: не PDF/JPG/PNG — загрузка не открывается', async () => {
    const w = await world()
    const res = await request(server)
      .post('/api/v1/documents/upload/multipart/start')
      .set(auth(w.studentTok))
      .send({ mime: 'video/mp4', size: BODY.byteLength })
      .expect(415)
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED')
  })

  it('документ: подписи на чужой ключ не выдаются', async () => {
    const w = await world()
    const started = await request(server)
      .post('/api/v1/documents/upload/multipart/start')
      .set(auth(w.studentTok))
      .send({ mime: 'application/pdf', size: BODY.byteLength })
      .expect(201)
    const { key, uploadId } = started.body.data as { key: string; uploadId: string }

    await request(server)
      .post('/api/v1/documents/upload/multipart/urls')
      .set(auth(w.strangerTok))
      .send({ key, uploadId, from: 1, to: 2 })
      .expect(403)
    // Убираем за собой незавершённую загрузку.
    await request(server)
      .post('/api/v1/documents/upload/multipart/abort')
      .set(auth(w.studentTok))
      .send({ key, uploadId })
      .expect(204)
  })

  it('сдача: файл собирается и прикладывается к черновику работы', async () => {
    const w = await world()
    const { body } = await uploadInParts(
      w.studentTok,
      `/api/v1/assignments/${w.assignmentId}/submission/files`,
      'report.pdf',
    )

    expect(body).toMatchObject({ name: 'report.pdf', mime: 'application/pdf' })
    await track(body.id as string)
    const submission = await prisma.submission.findFirstOrThrow({
      where: { assignmentId: w.assignmentId },
      select: { status: true, files: { select: { id: true } } },
    })
    expect(submission.status).toBe('DRAFT')
    expect(submission.files).toEqual([{ id: body.id }])
  })

  it('сдача: студент другой группы загрузку не откроет', async () => {
    const w = await world()
    const res = await request(server)
      .post(`/api/v1/assignments/${w.assignmentId}/submission/files/multipart/start`)
      .set(auth(w.strangerTok))
      .send({ mime: 'application/pdf', size: BODY.byteLength })
      .expect(403)
    expect(res.body.error.code).toBe('WRONG_SCOPE')
  })

  it('сдача: после abort собрать загрузку уже нельзя', async () => {
    const w = await world()
    const base = `/api/v1/assignments/${w.assignmentId}/submission/files`
    const started = await request(server)
      .post(`${base}/multipart/start`)
      .set(auth(w.studentTok))
      .send({ mime: 'application/pdf', size: BODY.byteLength })
      .expect(201)
    const { key, uploadId } = started.body.data as { key: string; uploadId: string }
    const urls = await request(server)
      .post(`${base}/multipart/urls`)
      .set(auth(w.studentTok))
      .send({ key, uploadId, from: 1, to: 1 })
      .expect(201)
    const url = (urls.body.data.parts as { url: string }[])[0]!.url
    const etag = await putSigned(url, BODY.subarray(0, FILE_UPLOAD.MULTIPART_PART_BYTES))

    await request(server)
      .post(`${base}/multipart/abort`)
      .set(auth(w.studentTok))
      .send({ key, uploadId })
      .expect(204)
    await request(server)
      .post(`${base}/multipart/complete`)
      .set(auth(w.studentTok))
      .send({ key, uploadId, parts: [{ part: 1, etag }] })
      .expect(400)
  })
})
